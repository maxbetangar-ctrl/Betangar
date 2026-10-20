-- ============================================================================
-- EL ESPEJO DEL ABONO DEJA DE DUPLICAR — arreglo del MECANISMO
-- 2026-10-20. Máximo: «limpia los 7 duplicados» → «arreglalo ahora».
--
-- EL MECANISMO QUE LOS FABRICA
-- `guardarAbono()` (app.js) crea un movimiento bancario cada vez que alguien
-- registra un abono:
--     bncMovPush({... desc:'Pago Alcaldia Fact.'+ab.fact, ref:ab.ref ...})
-- Sirve para que el ingreso se vea ANTES de que llegue el estado de cuenta. El
-- problema es que después el estado de cuenta trae el mismo cobro, y nadie
-- retira el espejo: el dinero queda contado dos veces. Al 20/10/2026 eran 7
-- movimientos por US$ 168.244, y por eso la utilidad del informe estaba alta.
--
-- ⛔ POR QUÉ NO ALCANZA CON MARCARLOS A MANO. Se probó: se les puso
--    `categoria='duplicado'` y el cobrado bajó a US$ 710.007 como debía… y al
--    rato habían vuelto a `cobro_alcaldia`. El clasificador automático
--    (`ident:imau`) mira el TEXTO, ve «Pago Alcaldia» y los re-clasifica. Una
--    limpieza que otro proceso deshace sola no es una limpieza.
--    [[norma-arreglar-el-mecanismo-no-el-caso]]
--
-- LA REGLA, ACÁ, DE UNA VEZ PARA SIEMPRE
-- Un crédito que NO viene del estado de cuenta (sin `control_number` ni
-- `cuenta`) y cuya `referencia` aparece DENTRO de la de otro crédito que SÍ
-- viene del estado de cuenta, con ≤5 días de diferencia, es el ESPEJO de ese
-- movimiento: no se cuenta.
--
-- ⛔ SE EMPAREJA POR REFERENCIA, NUNCA POR MONTO. El monto cambia con la tasa
--    del día en que se registró cada uno, y además se repite: hay dos cobros de
--    US$ 17.112 en septiembre. El dato que identifica es el raro.
--    [[norma-la-palabra-que-identifica-es-la-rara]]
--
-- ⛔ Y EL ESPEJO SIN GEMELO SIGUE CONTANDO. Mientras el estado de cuenta no
--    traiga ese cobro, el ingreso tiene que verse: si no, registrar un abono
--    haría desaparecer la plata de la pantalla hasta que llegue el banco.
--
-- ⛔ NO BORRA NI MARCA NADA. Las filas quedan intactas; lo que cambia es que la
--    fuente única del informe deja de sumarlas. Reversible: se revierte esta
--    función y vuelven a contar.
-- ============================================================================

-- ¿Este movimiento es el ESPEJO de uno que ya trajo el estado de cuenta?
create or replace function btg_es_espejo(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from bnc_movimientos m
      join bnc_movimientos r
        on r.control_number is not null
       and r.tipo = m.tipo
       and position(trim(m.referencia) in coalesce(r.referencia,'')) > 0
       and abs(r.fecha::date - m.fecha::date) <= 5
     where m.id = p_id
       and m.control_number is null
       and m.cuenta is null
       and nullif(trim(m.referencia),'') is not null
  )
$$;

comment on function btg_es_espejo is
  'TRUE si este movimiento lo fabricó la app al registrar un abono y el estado de cuenta ya trajo el mismo cobro. Se empareja por REFERENCIA contenida y fecha cercana, nunca por monto.';

-- ---------------------------------------------------------------------------
-- La fuente única del informe, con una línea más: el espejo no entra.
-- ---------------------------------------------------------------------------
create or replace function btg_estado_financiero(p_desde text, p_hasta text)
returns table (bloque text, orden integer, concepto text, movimientos bigint,
               bs numeric, usd numeric, sin_tasa bigint, estimado boolean)
language sql
security definer
set search_path = 'public'
as $function$
  select _q.* from (
with m as (
    select b.*, btg_tasa_mov(b.fecha::date, b.tasa_real, b.categoria) tasa
      from bnc_movimientos b
     where b.fecha >= p_desde and b.fecha <= p_hasta
       and coalesce(b.categoria,'') <> 'prueba_sistema'   -- no es plata: fue una prueba
       -- ⛔ EL ESPEJO DEL ABONO NO SE CUENTA cuando el estado de cuenta ya trajo
       --    el mismo cobro. Si no, el dinero entra dos veces y la utilidad sube
       --    sin que nada lo note. (2026-10-20)
       and not btg_es_espejo(b.id)
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
        when tipo='credito' and categoria='cobro_alcaldia' then 'Cobrado a la Alcaldía'
        when categoria='transito_terceros'                 then 'Dinero de terceros en tránsito (ni ingreso ni gasto)'
      when tipo='credito' and categoria='reverso'        then 'Devoluciones recibidas'
        when tipo='credito' and categoria='otro_ingreso'   then 'Otras entradas'
        when tipo='credito' and categoria='traspaso_interno' then 'Entró de otra cuenta nuestra'
        when tipo='credito'                                then 'Otras entradas ('||coalesce(categoria,'?')||')'
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
  ) _q where public.btg_ve_financiero_o_falla()
$function$;

comment on function btg_estado_financiero is
  'El estado financiero REAL del período, sacado del banco. Cada movimiento a la tasa de SU día. El bloque PATRIMONIAL sale del banco pero NO es gasto. ⛔ Desde el 20/10/2026 NO cuenta el ESPEJO del abono: el movimiento que la app fabrica al registrar un cobro, cuando el estado de cuenta ya trajo el mismo. Eran US$ 168.244 contados dos veces.';
