-- ============================================================================
-- Betangar · ESTADO FINANCIERO v2 — corrige tres defectos de la primera versión
-- 2026-08-09.
--
-- 1. ⛔ LA COMPRA DE DÓLARES SE VALUABA A BCV → decía «se ahorraron US$ 90.608»
--    cuando el ahorro real es US$ 71.119. Ahora usa `btg_tasa_mov`, que para
--    esa categoría exige la tasa pactada y NO cae a BCV.
-- 2. El concepto de un crédito salía siempre como «Otras entradas», aunque su
--    bloque fuera SOCIO o PATRIMONIAL. Aparecía tres veces con sentidos
--    distintos y eso solo se puede leer mal.
-- 3. Categorías crudas sin traducir en el cuadro del socio (`otro`,
--    `sin_clasificar`, `duplicado`). Si el socio no entiende el renglón, el
--    renglón no sirve.
-- ============================================================================

-- `create or replace` no puede cambiar el tipo de retorno: la v1 devolvía 7
-- columnas y esta devuelve 8 (`estimado`). Hay que borrarla primero.
drop function if exists btg_resumen_socio(text,text);
drop function if exists btg_estado_financiero(text,text);

create or replace function btg_estado_financiero(p_desde text, p_hasta text)
returns table (
  bloque      text,
  orden       int,
  concepto    text,
  movimientos bigint,
  bs          numeric,
  usd         numeric,
  sin_tasa    bigint,
  estimado    boolean
)
language sql
security definer
set search_path = public
as $$
  with m as (
    select b.*, btg_tasa_mov(b.fecha::date, b.tasa_real, b.categoria) tasa
      from bnc_movimientos b
     where b.fecha >= p_desde and b.fecha <= p_hasta
       and coalesce(b.categoria,'') <> 'prueba_sistema'   -- no es plata: fue una prueba
  ),
  cat as (
    select
      case
        when tipo='credito' and categoria in ('cobro_alcaldia','otro_ingreso','reverso') then 'INGRESOS'
        when tipo='debito' and categoria in ('nomina','combustible','mantenimiento','dotacion') then 'OPERACION'
        when tipo='debito' and categoria in ('servicios','alquiler','seguro','compra_software','software',
                           'tramites','caja_chica','bienestar_personal','comision_banco',
                           'implantacion_maxware','reembolso','otro','sin_clasificar',
                           'duplicado','⏳pendiente_explicar') then 'ADMINISTRACION'
        when tipo='debito' and categoria in ('impuestos','resp_social','parafiscales') then 'OBLIGACIONES'
        when tipo='debito' and categoria in ('pago_socio','asignacion_1b') then 'SOCIO'
        else 'PATRIMONIAL'
      end bloque,
      case
        -- ENTRADAS
        when tipo='credito' and categoria='cobro_alcaldia' then 'Cobrado a la Alcaldía'
        when tipo='credito' and categoria='reverso'        then 'Devoluciones recibidas'
        when tipo='credito' and categoria='otro_ingreso'   then 'Otras entradas'
        when tipo='credito' and categoria='traspaso_interno' then 'Entró de otra cuenta nuestra'
        when tipo='credito'                                then 'Otras entradas ('||coalesce(categoria,'?')||')'
        -- SALIDAS
        when categoria='nomina'              then 'Nómina'
        when categoria='combustible'         then 'Combustible'
        when categoria='mantenimiento'       then 'Mantenimiento de unidades'
        when categoria='dotacion'            then 'Dotación y uniformes'
        when categoria='servicios'           then 'Servicios'
        when categoria='alquiler'            then 'Alquiler'
        when categoria='seguro'              then 'Seguros'
        when categoria in ('compra_software','software') then 'Software'
        when categoria='tramites'            then 'Trámites y permisos'
        when categoria='caja_chica'          then 'Caja chica'
        when categoria='bienestar_personal'  then 'Bienestar del personal'
        when categoria='comision_banco'      then 'Comisiones bancarias'
        when categoria='implantacion_maxware' then 'Apoyo administrativo'
        when categoria='reembolso'           then 'Reembolsos'
        when categoria='otro'                then 'Otros gastos'
        when categoria='duplicado'           then 'Pagos duplicados (a reclamar al banco)'
        when categoria='sin_clasificar'      then '⚠️ Sin clasificar todavía'
        when categoria='⏳pendiente_explicar' then '⚠️ Pendiente de explicar'
        when categoria='impuestos'           then 'Impuestos y retenciones'
        when categoria='resp_social'         then 'Responsabilidad social'
        when categoria='parafiscales'        then 'Parafiscales'
        when categoria='pago_socio'          then 'Pago a socio (7% + 0,5%)'
        when categoria='asignacion_1b'       then 'Comisión 1B'
        when categoria='compra_divisas'      then 'Compra de dólares (ahorro, NO gasto)'
        when categoria='prestamo_empleado'   then 'Préstamos a empleados (se recuperan)'
        when categoria='traspaso_interno'    then 'Pasó a otra cuenta nuestra'
        else coalesce(categoria,'Sin clasificar')
      end concepto,
      monto, tasa, coalesce(tasa_estimada,false) est
    from m
  )
  select bloque,
         case bloque when 'INGRESOS' then 1 when 'OPERACION' then 2 when 'ADMINISTRACION' then 3
                     when 'OBLIGACIONES' then 4 when 'SOCIO' then 5 else 6 end,
         concepto,
         count(*),
         round(sum(monto)::numeric, 2),
         round(sum(monto / nullif(tasa,0))::numeric, 2),
         count(*) filter (where tasa is null),
         bool_or(est)
    from cat
   group by 1,2,3
   order by 2, 6 desc nulls last
$$;

revoke all on function btg_estado_financiero(text,text) from anon, public;
grant execute on function btg_estado_financiero(text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- El resumen de una línea. Los TRASPASOS ENTRE CUENTAS PROPIAS quedan fuera de
-- todo: entran y salen por el mismo monto y solo agrandan las cifras sin
-- cambiar nada. Mostrarlos hincha el cuadro y no informa.
-- ---------------------------------------------------------------------------
create or replace function btg_resumen_socio(p_desde text, p_hasta text)
returns table (
  cobrado_usd        numeric,
  otras_entradas_usd numeric,
  gasto_usd          numeric,
  utilidad_usd       numeric,
  margen_pct         numeric,
  ahorro_divisas_usd numeric,
  operacion_usd      numeric,
  administracion_usd numeric,
  obligaciones_usd   numeric,
  socio_usd          numeric,
  movs_sin_tasa      bigint,
  divisas_sin_valuar bigint
)
language sql
security definer
set search_path = public
as $$
  with e as (select * from btg_estado_financiero(p_desde, p_hasta)),
       ing as (select coalesce(sum(usd),0) v from e where bloque='INGRESOS' and concepto <> 'Entró de otra cuenta nuestra'),
       gas as (select coalesce(sum(usd),0) v from e where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO'))
  select
    coalesce((select sum(usd) from e where concepto='Cobrado a la Alcaldía'),0),
    coalesce((select sum(usd) from e where bloque='INGRESOS' and concepto not in ('Cobrado a la Alcaldía','Entró de otra cuenta nuestra')),0),
    (select v from gas),
    (select v from ing) - (select v from gas),
    case when (select v from ing) > 0
      then round((((select v from ing) - (select v from gas)) / (select v from ing) * 100)::numeric, 1)
      else 0 end,
    coalesce((select sum(usd) from e where concepto like 'Compra de dólares%'),0),
    coalesce((select sum(usd) from e where bloque='OPERACION'),0),
    coalesce((select sum(usd) from e where bloque='ADMINISTRACION'),0),
    coalesce((select sum(usd) from e where bloque='OBLIGACIONES'),0),
    coalesce((select sum(usd) from e where bloque='SOCIO'),0),
    coalesce((select sum(sin_tasa) from e where concepto not like 'Compra de dólares%'),0),
    coalesce((select sum(sin_tasa) from e where concepto like 'Compra de dólares%'),0)
$$;

revoke all on function btg_resumen_socio(text,text) from anon, public;
grant execute on function btg_resumen_socio(text,text) to authenticated;
