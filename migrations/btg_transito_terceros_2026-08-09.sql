-- ⛔ PLATA DE TERCEROS QUE PASA POR LA CUENTA NO ES NI INGRESO NI GASTO.
-- El 30/05 entraron Bs 1.293.600 de PEREZ MORAN PEDRO MIGUEL (cuenta ...15332) y ESE MISMO DÍA
-- salieron Bs 1.293.600 en dos partes A ESA MISMA CUENTA. Misma persona, misma cuenta, mismo monto:
-- es dinero en tránsito, no del negocio.
-- Con las salidas sin clasificar, el gasto se lo comía y el ingreso lo sumaba: se compensaban por
-- casualidad. Al clasificarlas como 'reverso' la salida dejó de restar pero la entrada SIGUIÓ
-- sumando (un crédito 'reverso' es "Devoluciones recibidas", que es INGRESOS), y la utilidad quedó
-- inflada en US$ 2.355. Arreglar una pata y no la otra fue peor que no tocar nada.
-- Ahora hay una categoría propia que sale de la utilidad por los DOS lados.
-- [[norma-salida-de-banco-no-es-gasto]] · [[norma-el-asiento-no-dice-que-se-vendio]]
CREATE OR REPLACE FUNCTION public.btg_estado_financiero(p_desde text, p_hasta text)
 RETURNS TABLE(bloque text, orden integer, concepto text, movimientos bigint, bs numeric, usd numeric, sin_tasa bigint, estimado boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with m as (
    select b.*, btg_tasa_mov(b.fecha::date, b.tasa_real, b.categoria) tasa
      from bnc_movimientos b
     where b.fecha >= p_desde and b.fecha <= p_hasta
       and coalesce(b.categoria,'') <> 'prueba_sistema'   -- no es plata: fue una prueba
  ),
  cat as (
    select
      case
        when categoria='transito_terceros' then 'TRANSITO'
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
        when categoria='transito_terceros'                 then 'Dinero de terceros en tránsito (ni ingreso ni gasto)'
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
  ) _q where public.btg_ve_financiero()
$function$
;