-- ============================================================================
-- Betangar · CLASIFICAR LO QUE ENTRA, no solo lo que sale
-- 2026-08-09.
--
-- ⛔ EL DEFECTO QUE ARREGLA
-- Las reglas del 08/08 se escribieron pensando en SALIDAS y se aplican por texto
-- sin mirar si el movimiento es crédito o débito. Resultado medido sobre los
-- 2.432 movimientos reales:
--
--   76 CRÉDITOS con es_gasto = true  →  Bs 266.374.413,52
--
-- O sea: TODO lo que entra estaba marcado como gasto. Los casos concretos:
--   · 19 cobros de la Alcaldía cayeron en `pago_socio` porque su concepto dice
--     «fiel cumplimiento» — que en una SALIDA sí es el pago del 7,5% a Máximo,
--     pero en una ENTRADA es el 10% que deposita la Alcaldía.
--   ·  8 créditos en `impuestos` porque el texto nombra una retención.
--   ·  1 crédito en `mantenimiento`: es el REVERSO del pago duplicado a Auto
--     Unión del 29/06. Plata que vuelve, contada como si se hubiera gastado.
--   · 33 quedaron `sin_clasificar`, y la regla (e) le pone es_gasto=true a todo
--     lo que no casa — incluidos Bs 239 millones de cobros.
--
-- LA REGLA DE ORO QUE FALTABA: **un crédito NUNCA es un gasto.** `es_gasto`
-- significa «esto es un gasto del período»; algo que entra no puede serlo,
-- diga lo que diga el concepto. Es la hermana de la norma que ya teníamos al
-- revés: que salga del banco no lo hace un gasto.
-- [[norma-salida-de-banco-no-es-gasto]]
--
-- ⚠️ Y OTRA VEZ: EL TEXTO ES UNA PISTA, NO UN DATO. El mismo «fiel
-- cumplimiento» significa dos cosas opuestas según hacia dónde va la plata.
-- Lo que no miente es el RIF: G-200060204 = INSTITUTO MUNICIPAL DEL ASEO
-- URBANO, presente en 20 créditos por Bs 222.063.737,53.
-- ============================================================================

-- La Alcaldía como entidad, para que el cobro se reconozca por identificador y
-- no por cómo lo escribió el banco ese día (llega por BNC y por BANCAMIGA, con
-- el RIF escrito G-200060204 y G200060204).
insert into bnc_entidades (nombre, categoria, es_gasto, nota)
select 'INSTITUTO MUNICIPAL DEL ASEO URBANO (IMAU)', 'cobro_alcaldia', false,
       'El cliente. Sus créditos son COBROS. Deposita en dos patas: ≈90% neto y el 10% de fiel cumplimiento días después.'
where not exists (select 1 from bnc_entidades where nombre ilike '%ASEO URBANO%');

insert into bnc_entidad_ident (entidad_id, tipo, ident)
select e.id, 'rif', bnc_norm_ident('G-200060204')
  from bnc_entidades e where e.nombre ilike '%ASEO URBANO%'
on conflict (tipo, ident) do nothing;

-- ---------------------------------------------------------------------------
create or replace function bnc_clasificar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  -- (0) TRASPASO ENTRE CUENTAS PROPIAS. Va primero porque el concepto de un
  -- traspaso describe PARA QUÉ se manda la plata, no lo que el traspaso es.
  update bnc_movimientos m
     set categoria = 'traspaso_interno', es_gasto = false,
         clasificado_por = 'concepto:traspaso_interno', clasificado_at = now()
    from bnc_cuentas_propias c
   where position(c.cuenta in coalesce(m.descripcion,'')) > 0
     and c.cuenta is distinct from m.cuenta
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ══════════════════ LO QUE ENTRA ══════════════════
  -- Todo este bloque va ANTES de las reglas de gasto. Si fuera al revés, un
  -- cobro cuyo concepto dice «fiel cumplimiento» o «retención» ya se habría
  -- llevado la categoría equivocada y acá no habría nada que corregir.

  -- (i1) COBRO DE LA ALCALDÍA — por RIF, que es lo único que no cambia.
  update bnc_movimientos
     set categoria = 'cobro_alcaldia', es_gasto = false,
         clasificado_por = 'ident:imau', clasificado_at = now()
   where tipo = 'credito'
     and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and (bnc_norm_ident(descripcion) like '%G200060204%'
          or descripcion ~* 'instituto municipal del aseo|\yimau\y|alcald[ií]a')
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- (i2) REVERSO — plata que VUELVE de un pago que rebotó o salió duplicado.
  -- No es un ingreso del negocio: es la corrección de una salida. Se marca
  -- aparte para que no infle las entradas ni se confunda con un cobro.
  -- ⚠️ El débito hermano sigue contando como gasto hasta que alguien lo empareje
  -- a mano: emparejarlos solos por monto inventa coincidencias (dos empleados
  -- con el mismo sueldo el mismo día NO son un duplicado). Queda anotado.
  update bnc_movimientos
     set categoria = 'reverso', es_gasto = false,
         clasificado_por = 'concepto:reverso', clasificado_at = now()
   where tipo = 'credito'
     and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and descripcion ~* 'devoluci[oó]n recibida|\yreverso\y|pago duplicado|cliente no corresponde|cuenta cancelada|cta\.?invalida'
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- (i3) EL RESTO DE LAS ENTRADAS. Se marcan como tales en vez de dejarlas
  -- caer en las reglas de gasto de abajo. `otro_ingreso` NO es un cajón de
  -- sastre invisible: sale en la lista de lo que falta mirar, igual que
  -- `sin_clasificar`, pero sin mentir diciendo que es un gasto.
  update bnc_movimientos
     set categoria = 'otro_ingreso', es_gasto = false,
         clasificado_por = 'regla:entrada_sin_identificar', clasificado_at = now()
   where tipo = 'credito'
     and coalesce(categoria,'') not in ('traspaso_interno','cobro_alcaldia','reverso')
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ══════════════════ LO QUE SALE ══════════════════
  -- De acá para abajo, TODO lleva `tipo = 'debito'`. Sin ese filtro, cada regla
  -- de texto vuelve a llevarse créditos por delante, que es el defecto que esta
  -- migración corrige.

  update bnc_movimientos m
     set entidad_id = i.entidad_id
    from bnc_entidad_ident i
   where m.tipo = 'debito'
     and bnc_norm_ident(m.descripcion) like '%' || i.ident || '%'
     and length(i.ident) > 5
     and m.entidad_id is distinct from i.entidad_id
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria = 'compra_divisas', es_gasto = false,
         clasificado_por = 'concepto:autounion_divisas', clasificado_at = now()
    from bnc_entidades e
   where m.tipo = 'debito' and m.entidad_id = e.id and e.nombre ilike 'AUTO UNION%'
     and m.descripcion ~* 'asignaci|consignaci|cambio de moneda|deuda camion'
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria = 'alquiler', es_gasto = true,
         clasificado_por = 'concepto:palotal_alquiler', clasificado_at = now()
    from bnc_entidades e
   where m.tipo = 'debito' and m.entidad_id = e.id and e.nombre ilike '%PAZ JIMENEZ%'
     and m.descripcion ~* 'alquiler|arrendamiento|galp[oó]n'
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria = 'reembolso', es_gasto = true,
         clasificado_por = 'concepto:maximo_reembolso', clasificado_at = now()
    from bnc_entidades e
   where m.tipo = 'debito' and m.entidad_id = e.id and e.nombre = 'MÁXIMO BETANCOURT'
     and m.descripcion ~* 'reembolso|compras en exterior|devoluci|prestamo|prÉstamo|equipos importados|zoom'
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria = 'comision_banco', es_gasto = true,
         clasificado_por = 'concepto:comision', clasificado_at = now()
   where tipo = 'debito'
     and descripcion ~* 'comisi[oó]n bancaria|comision x cred|comisi[oó]n mantenimiento'
     and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria = e.categoria, es_gasto = e.es_gasto,
         clasificado_por = 'entidad', clasificado_at = now()
    from bnc_entidades e
   where m.tipo = 'debito' and m.entidad_id = e.id
     and m.categoria is null
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria = v.cat, es_gasto = v.gasto,
         clasificado_por = 'concepto:'||v.regla, clasificado_at = now()
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
   where bnc_movimientos.tipo = 'debito'
     and bnc_movimientos.categoria is null
     and bnc_movimientos.descripcion ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria = 'sin_clasificar', es_gasto = true,
         clasificado_por = 'ninguna_regla', clasificado_at = now()
   where tipo = 'debito' and categoria is null
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ══════════════ EL CANDADO ══════════════
  -- Última línea de defensa: pase lo que pase arriba, un crédito no es un gasto.
  -- Está acá y no solo en cada regla porque una regla nueva mal escrita mañana
  -- volvería a meter el mismo error, y este candado no depende de acordarse.
  update bnc_movimientos set es_gasto = false
   where tipo = 'credito' and es_gasto is not false;

  select count(*) into n from bnc_movimientos where categoria is not null;
  return n;
end $$;

revoke all on function bnc_clasificar() from anon, public;
grant execute on function bnc_clasificar() to authenticated;
