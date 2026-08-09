-- ============================================================================
-- Betangar · LA CLASIFICACIÓN USA EL `Type` DEL BANCO ANTES QUE EL CONCEPTO
-- 2026-08-09.
--
-- ⛔ POR QUÉ ES URGENTE
-- Los datos se corrigieron a mano (Bs 5,2 MM de impuestos que estaban como
-- «traspaso entre cuentas propias»), pero `bnc_clasificar()` seguía mirando el
-- CONCEPTO. El traído automático corre a las 07:00 y habría vuelto a marcar mal
-- los impuestos de la cuenta 2 al día siguiente — el mismo error, otra vez, y
-- sin que nadie se entere.
-- Corregir el dato sin corregir la regla es dejar el error programado.
--
-- LA REGLA: cuando el banco da un campo ESTRUCTURADO, ese manda.
--   Type = 'PAGO DE IMPUESTOS BNCNET CARGO'  → impuestos, siempre
--   Type ilike '%Comisi%'                     → comisión bancaria, siempre
-- El texto libre se hereda de otra operación, se copia y se equivoca. Casos
-- reales, los tres del mismo día:
--   · un EGRESO de impuestos con el texto de un INGRESO
--   · una COMISIÓN con el texto de la transferencia que la generó
--   · un cobro de la Alcaldía cuyo texto de oficina no la nombra
-- El `Type` lo escribe la máquina del banco: no hereda nada.
-- ============================================================================

create or replace function bnc_clasificar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  -- ══════════ (0) LO QUE DICE EL BANCO, ANTES QUE CUALQUIER TEXTO ══════════
  -- Va PRIMERO y por eso nada de lo de abajo lo pisa: `categoria` ya queda puesta
  -- y todas las reglas siguientes exigen `categoria is null` o se saltan lo ya decidido.
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

  -- ══════════ (1) TRASPASO ENTRE CUENTAS PROPIAS ══════════
  -- Ahora exige que el banco NO haya dicho ya qué es. Sin ese filtro, un pago de
  -- impuestos cuyo concepto heredado nombra la cuenta principal vuelve a caer acá.
  update bnc_movimientos m
     set categoria='traspaso_interno', es_gasto=false,
         clasificado_por='concepto:traspaso_interno', clasificado_at=now()
    from bnc_cuentas_propias c
   where position(c.cuenta in (coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,''))) > 0
     and c.cuenta is distinct from m.cuenta
     and coalesce(m.tipo_banco,'') not ilike '%PAGO DE IMPUESTOS%'
     and coalesce(m.tipo_banco,'') not ilike '%Comisi%'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ══════════ LO QUE ENTRA ══════════
  update bnc_movimientos
     set categoria='reverso', es_gasto=false,
         clasificado_por='concepto:reverso', clasificado_at=now()
   where tipo='credito'
     and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and (coalesce(descripcion,'') || ' ' || coalesce(concepto_banco,'')) ~* 'devoluci[oó]n recibida|\yreverso\y|pago duplicado|cliente no corresponde|cuenta cancelada|cta\.?invalida'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='cobro_alcaldia', es_gasto=false,
         clasificado_por='ident:imau', clasificado_at=now()
   where tipo='credito'
     and coalesce(categoria,'') not in ('traspaso_interno','reverso')
     and (bnc_norm_ident(coalesce(descripcion,'') || coalesce(concepto_banco,'')) like '%G200060204%'
          or (coalesce(descripcion,'') || ' ' || coalesce(concepto_banco,'')) ~* 'instituto municipal del aseo|\yimau\y|alcald[ií]a|fc segun factura')
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='otro_ingreso', es_gasto=false,
         clasificado_por='regla:entrada_sin_identificar', clasificado_at=now()
   where tipo='credito'
     and coalesce(categoria,'') not in ('traspaso_interno','cobro_alcaldia','reverso')
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ══════════ LO QUE SALE ══════════
  update bnc_movimientos m
     set entidad_id = i.entidad_id
    from bnc_entidad_ident i
   where m.tipo='debito'
     and bnc_norm_ident(coalesce(m.descripcion,'') || coalesce(m.concepto_banco,'')) like '%' || i.ident || '%'
     and length(i.ident) > 5 and m.entidad_id is distinct from i.entidad_id
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='compra_divisas', es_gasto=false,
         clasificado_por='concepto:autounion_divisas', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre ilike 'AUTO UNION%'
     and (coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,'')) ~* 'asignaci|consignaci|cambio de moneda|deuda camion'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='alquiler', es_gasto=true,
         clasificado_por='concepto:palotal_alquiler', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre ilike '%PAZ JIMENEZ%'
     and (coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,'')) ~* 'alquiler|arrendamiento|galp[oó]n'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='reembolso', es_gasto=true,
         clasificado_por='concepto:maximo_reembolso', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre='MÁXIMO BETANCOURT'
     and (coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,'')) ~* 'reembolso|compras en exterior|devoluci|prestamo|prÉstamo|equipos importados|zoom'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='comision_banco', es_gasto=true,
         clasificado_por='concepto:comision', clasificado_at=now()
   where tipo='debito'
     and (coalesce(descripcion,'') || ' ' || coalesce(concepto_banco,'')) ~* 'comisi[oó]n bancaria|comision x cred|comisi[oó]n mantenimiento'
     and coalesce(categoria,'') not in ('traspaso_interno','impuestos')
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria=e.categoria, es_gasto=e.es_gasto,
         clasificado_por='entidad', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and m.categoria is null
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria=v.cat, es_gasto=v.gasto,
         clasificado_por='concepto:'||v.regla, clasificado_at=now()
    from (values
      ('prestamo_empleado', false, 'prestamo',    '(prestamo|préstamo).*(empleado|medicament)|prestamo a empleado'),
      ('pago_socio',        true,  'socio',       'pago a socio|pago socio|fiel cumpl|sociedad betangar|abono 0,5|reparto de dividendo'),
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
     and (coalesce(bnc_movimientos.descripcion,'') || ' ' || coalesce(bnc_movimientos.concepto_banco,'')) ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='sin_clasificar', es_gasto=true,
         clasificado_por='ninguna_regla', clasificado_at=now()
   where tipo='debito' and categoria is null
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ══════════ EL CANDADO ══════════
  update bnc_movimientos set es_gasto=false where tipo='credito' and es_gasto is not false;

  select count(*) into n from bnc_movimientos where categoria is not null;
  return n;
end $$;

revoke all on function bnc_clasificar() from anon, public;
grant execute on function bnc_clasificar() to authenticated;
