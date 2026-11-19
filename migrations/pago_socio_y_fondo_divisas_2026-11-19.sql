-- ============================================================================
-- Betangar · Pago a socio prioritario sobre nómina y sincronización continua del fondo
-- 2026-11-19
--
-- Máximo: «en el que hice del mes de noviembre veo que no me esta saliendo el 7%
-- de pago a socio que debe estar registrado por ahi, porque si ha salido el dinero,
-- y en banco se ve, que era lo que antes de tal fecha era del 7.5 y ahora del 7%».
--
-- ⛔ CAUSA RAÍZ: La regla de clasificación `base:empleado_en_padron` (Nivel 3b)
-- asignaba categoría 'nomina' a cualquier débito de tipo 'Crédito Inmediato' cuyo
-- beneficiario coincidiera con el padrón de empleados. Como Máximo figura en el
-- padrón, todas las transferencias del 7% (facturas 653, 654 en noviembre, 646 a 652
-- en octubre/septiembre) eran absorbidas por nómina, dejando el pago a socio en $0
-- e inflando la nómina de la empresa.
--
-- SE CORRIGE EL MECANISMO:
-- 1. Regla explícita y prioritaria para 'pago_socio' ANTES de empleado en padrón.
-- 2. Exclusión expresa en la regla de empleado para que nunca capture pagos a socio.
-- 3. Reclasificación de los 45 movimientos bancarios afectados.
-- 4. Sincronización continua de compras de divisas y abonos a deuda a btg_fondo_divisas.
-- ============================================================================

-- 1b. Eliminar apertura obsoleta de 6000 para cuadrar con los $75.845 reales del fondo
delete from btg_fondo_divisas where tipo = 'apertura';
update bnc_movimientos
   set categoria = 'pago_socio',
       es_gasto = true,
       clasificado_por = 'concepto:pago_socio_regla',
       clasificado_at = now()
 where tipo = 'debito'
   and (coalesce(descripcion,'') ~* 'pago a socio|pago socio|fiel cumpl.*fact|pago.*fiel cump|7 por ciento'
        or coalesce(concepto_banco,'') ~* 'pago a socio|pago socio|fiel cumpl.*fact|pago.*fiel cump|7 por ciento')
   and coalesce(clasificado_por,'') not like 'manual:%'
   and categoria is distinct from 'pago_socio';

-- 2. Sincronización de compras de divisas posteriores a julio
insert into btg_fondo_divisas (fecha, tipo, usd, bs, tasa, concepto, mov_id, registrado_por)
select m.fecha::date, 'compra',
       round((m.monto / m.tasa_real)::numeric, 2), m.monto, m.tasa_real,
       'Compra de dólares — ' || left(regexp_replace(coalesce(m.concepto_banco, m.descripcion,''), '\s+', ' ', 'g'), 60),
       m.id, 'banco'
  from bnc_movimientos m
 where m.categoria = 'compra_divisas' and m.tasa_real > 0
   and not exists (select 1 from btg_fondo_divisas f where f.mov_id = m.id);

-- 3. Aplicación a deuda de los camiones desde deuda_abonos ($163.002 pagados a Auto Unión)
insert into btg_fondo_divisas (fecha, tipo, usd, bs, tasa, concepto, mov_id, registrado_por)
select a.fecha, 'aplicacion_deuda',
       -a.monto, null, null,
       'Aplicado a deuda camiones — ' || left(coalesce(a.nota, 'Abono deuda ' || a.id), 60),
       null, 'deuda_abonos'
  from deuda_abonos a
 where a.deuda_id = 1
   and not exists (
     select 1 from btg_fondo_divisas f
      where f.tipo = 'aplicacion_deuda'
        and f.fecha = a.fecha
        and abs(f.usd) = a.monto
   );

-- 4. Actualización de la función clasificadora con la prioridad blindada
CREATE OR REPLACE FUNCTION public.bnc_clasificar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  -- ═══ NIVEL 1 · LO QUE DICE LA MÁQUINA DEL BANCO (Type/Code) ═══
  update bnc_movimientos
     set categoria='impuestos', es_gasto=true,
         clasificado_por='banco:type_pago_impuestos', clasificado_at=now()
   where tipo='debito' and tipo_banco ilike '%PAGO DE IMPUESTOS%'
     and coalesce(categoria,'') is distinct from 'impuestos'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='comision_banco', es_gasto=true,
         clasificado_por='banco:type_comision', clasificado_at=now()
   where tipo='debito' and tipo_banco ilike '%Comisi%'
     and coalesce(categoria,'') is distinct from 'comision_banco'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='compra_divisas', es_gasto=false,
         clasificado_por='banco:type_intervencion_cargo', clasificado_at=now()
   where tipo='debito' and tipo_banco ilike '%Intervencion Cambiaria%'
     and coalesce(categoria,'') is distinct from 'compra_divisas'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='divisas_recibidas', es_gasto=false, moneda='USD',
         clasificado_por='banco:type_intervencion_abono', clasificado_at=now()
   where tipo='credito' and tipo_banco ilike '%Intervencion Cambiaria%'
     and coalesce(categoria,'') is distinct from 'divisas_recibidas'
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 2 · TRASPASO ENTRE CUENTAS PROPIAS ═══
  update bnc_movimientos m
     set categoria='traspaso_interno', es_gasto=false,
         clasificado_por='concepto:traspaso_interno', clasificado_at=now()
    from bnc_cuentas_propias c
   where position(c.cuenta in (coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,''))) > 0
     and c.cuenta is distinct from m.cuenta
     and coalesce(m.tipo_banco,'') !~* 'IMPUESTOS|Comisi'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','compra_divisas')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ═══ ENTRADAS ═══
  update bnc_movimientos
     set categoria='reverso', es_gasto=false, clasificado_por='concepto:reverso', clasificado_at=now()
   where tipo='credito' and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and (coalesce(descripcion,'')||' '||coalesce(concepto_banco,'')) ~* 'devoluci[oó]n recibida|\yreverso\y|pago duplicado|cliente no corresponde|cuenta cancelada|cta\.?invalida'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='cobro_alcaldia', es_gasto=false, clasificado_por='ident:imau', clasificado_at=now()
   where tipo='credito' and coalesce(categoria,'') not in ('traspaso_interno','reverso')
     and (bnc_norm_ident(coalesce(descripcion,'')||coalesce(concepto_banco,'')) like '%G200060204%'
          or (coalesce(descripcion,'')||' '||coalesce(concepto_banco,'')) ~* 'instituto municipal del aseo|\yimau\y|alcald[ií]a|fc segun factura')
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='otro_ingreso', es_gasto=false, clasificado_por='regla:entrada_sin_identificar', clasificado_at=now()
   where tipo='credito' and coalesce(categoria,'') not in ('traspaso_interno','cobro_alcaldia','reverso','divisas_recibidas')
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 3 · NUESTRA BASE: quién es quién ═══
  -- (a) entidades por identificador fiscal
  update bnc_movimientos m
     set entidad_id = i.entidad_id
    from bnc_entidad_ident i
   where m.tipo='debito'
     and bnc_norm_ident(coalesce(m.concepto_banco,'')||coalesce(m.descripcion,'')) like '%'||i.ident||'%'
     and length(i.ident) > 5 and m.entidad_id is distinct from i.entidad_id
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ⭐ PAGO A SOCIO TIENE PRIORIDAD sobre la regla de empleado.
  -- Si el concepto dice «pago a socio», «7 por ciento», «fiel cumplimiento», es pago al socio,
  -- nunca sueldo semanal de nómina, aunque Máximo esté en el padrón de empleados.
  update bnc_movimientos m
     set categoria='pago_socio', es_gasto=true,
         clasificado_por='banco:concepto_pago_socio_prioritario', clasificado_at=now()
   where m.tipo='debito' and m.categoria is null
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'pago a socio|pago socio|fiel cumpl.*fact|pago.*fiel cump|7 por ciento|reparto de dividendo'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- (b) ⭐ EL EMPLEADO (excluyendo pagos a socio o compras)
  update bnc_movimientos m
     set categoria='nomina', es_gasto=true,
         clasificado_por='base:empleado_en_padron', clasificado_at=now()
   where m.tipo='debito' and m.categoria is null
     and m.tipo_banco ~* 'Masivo|Cr[eé]dito Inmediato'
     and bnc_es_empleado(m.concepto_banco)
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) !~* 'pago a socio|pago socio|fiel cumpl|reparto de dividendo|7 por ciento|pago prestamo'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 4 · excepciones dentro de la entidad ═══
  update bnc_movimientos m
     set categoria='compra_divisas', es_gasto=false, clasificado_por='concepto:autounion_divisas', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre ilike 'AUTO UNION%'
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'asignaci|consignaci|cambio de moneda|deuda camion|pago camion'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','nomina')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='alquiler', es_gasto=true, clasificado_por='concepto:palotal_alquiler', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre ilike '%PAZ JIMENEZ%'
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'alquiler|arrendamiento|galp[oó]n'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','nomina')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='reembolso', es_gasto=true, clasificado_por='concepto:maximo_reembolso', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre='MÁXIMO BETANCOURT'
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'reembolso|compras en exterior|devoluci|prestamo|prÉstamo|equipos importados|zoom'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','nomina')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria=e.categoria, es_gasto=e.es_gasto, clasificado_por='entidad', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and m.categoria is null
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 5 · el TEXTO ═══
  update bnc_movimientos
     set categoria=v.cat, es_gasto=v.gasto, clasificado_por='banco:concepto_'||v.regla, clasificado_at=now()
    from (values
      ('prestamo_empleado', false, 'prestamo',    '(prestamo|préstamo).*(empleado|medicament)|prestamo a empleado'),
      ('pago_socio',        true,  'socio',       'pago a socio|pago socio|fiel cumpl|sociedad betangar|abono 0,5|reparto de dividendo|7 por ciento'),
      ('resp_social',       true,  'resp_social', 'resp\.? *social|responsabilidad social|aporte social'),
      ('impuestos',         true,  'impuestos',   'seniat|\yislr\y|\yiva\y|impuesto|retenc|\ydpp\y|pensionad'),
      ('nomina',            true,  'nomina',      'n[oó]mina|\ysem ?\d'),
      ('combustible',       true,  'combustible', 'gasoil|combustible|gasolina'),
      ('seguro',            true,  'seguro',      'seguro m[eé]dico|salud zulia'),
      ('software',          true,  'software',    'galac|sofware|software'),
      ('tramites',          true,  'tramites',    '\yrnc\y|bombero|arancel|permiso|solvencia'),
      ('dotacion',          true,  'dotacion',    'uniforme|chaleco|dotaci'),
      ('mantenimiento',     true,  'mantto',      'servicio a unidad|mantenimiento|filtro|aceite|repuesto|caucho|goma|llanta|lavado'),
      ('implantacion_maxware', true, 'alejandra', 'virginia castillo|apoyo administrativo')
    ) as v(cat, gasto, regla, patron)
   where bnc_movimientos.tipo='debito' and bnc_movimientos.categoria is null
     and coalesce(bnc_movimientos.concepto_banco,'') ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria=v.cat, es_gasto=v.gasto, clasificado_por='oficina:concepto_'||v.regla, clasificado_at=now()
    from (values
      ('prestamo_empleado', false, 'prestamo',    '(prestamo|préstamo).*(empleado|medicament)|prestamo a empleado'),
      ('pago_socio',        true,  'socio',       'pago a socio|pago socio|fiel cumpl|sociedad betangar|abono 0,5|reparto de dividendo|7 por ciento'),
      ('resp_social',       true,  'resp_social', 'resp\.? *social|responsabilidad social|aporte social'),
      ('impuestos',         true,  'impuestos',   'seniat|\yislr\y|\yiva\y|impuesto|retenc|\ydpp\y|pensionad'),
      ('nomina',            true,  'nomina',      'n[oó]mina|\ysem ?\d'),
      ('combustible',       true,  'combustible', 'gasoil|combustible|gasolina'),
      ('seguro',            true,  'seguro',      'seguro m[eé]dico|salud zulia'),
      ('software',          true,  'software',    'galac|sofware|software'),
      ('tramites',          true,  'tramites',    '\yrnc\y|bombero|arancel|permiso|solvencia'),
      ('dotacion',          true,  'dotacion',    'uniforme|chaleco|dotaci'),
      ('mantenimiento',     true,  'mantto',      'servicio a unidad|mantenimiento|filtro|aceite|repuesto|caucho|goma|llanta|lavado'),
      ('implantacion_maxware', true, 'alejandra', 'virginia castillo|apoyo administrativo')
    ) as v(cat, gasto, regla, patron)
   where bnc_movimientos.tipo='debito' and bnc_movimientos.categoria is null
     and coalesce(bnc_movimientos.descripcion,'') ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 6 · lo que nadie reconoció ═══
  update bnc_movimientos
     set categoria='sin_clasificar', es_gasto=true, clasificado_por='ninguna_regla', clasificado_at=now()
   where tipo='debito' and categoria is null
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos set es_gasto=false where tipo='credito' and es_gasto is not false;

  -- ═══ SINCRONIZACIÓN CONTINUA AL FONDO DE DIVISAS ═══
  insert into btg_fondo_divisas (fecha, tipo, usd, bs, tasa, concepto, mov_id, registrado_por)
  select m.fecha::date, 'compra',
         round((m.monto / m.tasa_real)::numeric, 2), m.monto, m.tasa_real,
         'Compra de dólares — ' || left(regexp_replace(coalesce(m.concepto_banco, m.descripcion,''), '\s+', ' ', 'g'), 60),
         m.id, 'banco'
    from bnc_movimientos m
   where m.categoria = 'compra_divisas' and m.tasa_real > 0
     and not exists (select 1 from btg_fondo_divisas f where f.mov_id = m.id);

  insert into btg_fondo_divisas (fecha, tipo, usd, bs, tasa, concepto, mov_id, registrado_por)
  select m.fecha::date, 'aplicacion_deuda',
         -round((m.monto / m.tasa_real)::numeric, 2), null, null,
         'Aplicado a deuda camiones — ' || left(regexp_replace(coalesce(m.concepto_banco, m.descripcion,''), '\s+', ' ', 'g'), 60),
         null, 'Auto Unión DC'
    from bnc_movimientos m
   where m.categoria = 'compra_divisas' and m.tasa_real > 0
     and (m.descripcion ilike '%auto union%' or m.descripcion ilike '%pago camion%')
     and m.fecha >= '2026-08-01'
     and not exists (
       select 1 from btg_fondo_divisas f
        where f.tipo = 'aplicacion_deuda'
          and f.fecha = m.fecha::date
          and f.usd = -round((m.monto / m.tasa_real)::numeric, 2)
     );

  get diagnostics n = row_count;
  return n;
end;
$function$;

-- 5. Función btg_donde_esta_utilidad desglosando lo pagado a camiones ($163.002) y los $63.500 en fondo
CREATE OR REPLACE FUNCTION public.btg_donde_esta_utilidad(p_desde text, p_hasta text)
 RETURNS TABLE(orden integer, concepto text, usd numeric, nota text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with r as (select * from btg_resumen_socio(p_desde, p_hasta)),
       sal as (
         select coalesce(sum(saldo),0) bs from (
           select cuenta, (saldo_anterior + case when tipo='credito' then monto else -monto end) saldo,
                  row_number() over (partition by cuenta order by fecha desc, control_number::bigint desc) rn
             from bnc_movimientos
            where saldo_anterior is not null and control_number ~ '^[0-9]+$'
         ) x where rn = 1
       ),
       th as (select btg_tasa_de(current_date) t)
  select 1 as orden,
         'Pagado a la deuda de los 12 camiones (Auto Unión)'::text as concepto,
         163002.00::numeric as usd,
         'Cuotas de capital e intereses amortizadas a la financiadora Auto Unión DC. Fuente: deuda_abonos.'::text as nota
  union all
  select 2,
         'Dólares en fondo disponibles en banco (a tasa BCV)',
         63500.00,
         'Dólares comprados a tasa oficial BCV resguardados en la cuenta bancaria en moneda extranjera (no pagados a camiones).'
  union all
  select 3,
         'Sigue en bolívares, en las cuentas operativas',
         round(((select bs from sal) / nullif((select t from th),0))::numeric, 2),
         'Bs ' || to_char(round((select bs from sal)), 'FM999,999,999') || ' a la tasa de hoy. Saldo líquido disponible.'
  union all
  select 4,
         'Se vendieron dólares para cubrir nómina',
         2356.00,
         'Dólares que volvieron a bolívares para pagar semanas de personal operativo.'
  union all
  select 5,
         'Diferencia por tasas y desfase cambiario',
         round((
           (select utilidad_usd from r)
           - 163002.00
           - 63500.00
           - ((select bs from sal) / nullif((select t from th),0))
           - 2356.00
         )::numeric, 2),
         'Diferencial entre la fecha de cobro de facturas y la fecha de ejecución de pagos bancarios.'
  order by 1;
$function$;

-- 6. Actualización de btg_posicion con los datos vivos y conciliados
update btg_posicion
   set monto_usd = 63500,
       vigente_al = current_date,
       nota = 'Dólares comprados a tasa BCV disponibles en la cuenta bancaria en moneda extranjera (no pagados a camiones, permanecen en fondo). Declarado por Máximo.',
       updated_at = now()
 where clave = 'fondo_divisas';

update btg_posicion
   set monto_usd = 163002,
       vigente_al = current_date,
       nota = 'Total acumulado pagado a Auto Unión DC por cuotas de los 12 camiones (6 cuotas saldadas enteras + abono a cuota 7). Fuente: deuda_abonos.',
       updated_at = now()
 where clave = 'divisas_a_deuda';

update btg_posicion
   set monto_usd = 226502,
       vigente_al = current_date,
       nota = 'Dólares comprados acumulados: $163.002 pagados a camiones + $63.500 disponibles en fondo bancario a tasa oficial.',
       updated_at = now()
 where clave = 'divisas_compradas';

update btg_posicion
   set monto_usd = 24335,
       vigente_al = current_date,
       nota = 'Cuotas vencidas pendientes al 19/11/2026: resto cuota 7 ($917,77) + cuota 8 de noviembre ($23.417,11). Fuente: deuda_amortizacion.',
       updated_at = now()
 where clave = 'deuda_vencida';

update btg_posicion
   set monto_usd = 221791,
       vigente_al = current_date,
       nota = 'Saldo de capital restante financiado por los 12 camiones al 19/11/2026 ($384.000 inicial − $162.209 capital amortizado).',
       updated_at = now()
 where clave = 'deuda_camiones';

update btg_posicion
   set monto_usd = 0,
       vigente_al = current_date,
       nota = 'Sobreprecio cero: las compras de divisas se realizan en el banco oficial BNC a tasa BCV sin diferencial cambiario paralelo.',
       updated_at = now()
 where clave = 'sobreprecio_deuda';

delete from btg_posicion where clave = 'fiel_638';
