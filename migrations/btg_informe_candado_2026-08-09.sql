-- Candado del informe, SIN cambiar el lenguaje de las funciones.
-- Primer intento: envolver en plpgsql con PERFORM + RETURN QUERY. Rompió btg_resumen_socio, porque
-- plpgsql exige que los tipos calcen EXACTO y SQL los coacciona (numeric -> bigint en movs_sin_tasa).
-- Se revirtió y se hizo asi: el cuerpo original queda intacto y el permiso filtra el resultado.
-- Devuelve VACIO, no error; por eso la app comprueba btg_ve_financiero() y muestra el motivo — si
-- no, un vacio se leeria como "no hay datos" en vez de "no te toca".

CREATE OR REPLACE FUNCTION public.btg_resumen_socio(p_desde text, p_hasta text)
 RETURNS TABLE(cobrado_usd numeric, otras_entradas_usd numeric, gasto_usd numeric, cambiario_usd numeric, utilidad_usd numeric, margen_pct numeric, ahorro_divisas_usd numeric, operacion_usd numeric, administracion_usd numeric, obligaciones_usd numeric, socio_usd numeric, movs_sin_tasa bigint, divisas_sin_valuar bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with e as (select * from btg_estado_financiero(p_desde, p_hasta)),
       ing as (select coalesce(sum(usd),0) v from e where bloque='INGRESOS' and concepto <> 'Entró de otra cuenta nuestra'),
       gas as (select coalesce(sum(usd),0) v from e where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO')),
       -- Solo lo REALIZADO (orden 1 y 2). El orden 3 es futuro y no se carga al período.
       camb as (select coalesce(sum(usd),0) v from btg_perdida_cambiaria(p_desde,p_hasta) where orden in (1,2))
  select
    coalesce((select sum(usd) from e where concepto='Cobrado a la Alcaldía'),0),
    coalesce((select sum(usd) from e where bloque='INGRESOS' and concepto not in ('Cobrado a la Alcaldía','Entró de otra cuenta nuestra')),0),
    (select v from gas),
    (select v from camb),
    (select v from ing) - (select v from gas) - (select v from camb),
    case when (select v from ing) > 0
      then round((((select v from ing) - (select v from gas) - (select v from camb)) / (select v from ing) * 100)::numeric, 1)
      else 0 end,
    coalesce((select sum(usd) from e where concepto like 'Compra de dólares%'),0),
    coalesce((select sum(usd) from e where bloque='OPERACION'),0),
    coalesce((select sum(usd) from e where bloque='ADMINISTRACION'),0),
    coalesce((select sum(usd) from e where bloque='OBLIGACIONES'),0),
    coalesce((select sum(usd) from e where bloque='SOCIO'),0),
    coalesce((select sum(sin_tasa) from e where concepto not like 'Compra de dólares%'),0),
    coalesce((select sum(sin_tasa) from e where concepto like 'Compra de dólares%'),0)
  ) _q where public.btg_ve_financiero()
$function$;

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
  ) _q where public.btg_ve_financiero()
$function$;

CREATE OR REPLACE FUNCTION public.btg_utilidad_real_y_estimada(p_desde text, p_hasta text)
 RETURNS TABLE(utilidad_real_usd numeric, por_facturar_usd numeric, viajes_sin_facturar bigint, utilidad_estimada_usd numeric, margen_real_pct numeric, margen_estimado_pct numeric, tarifa_usada numeric, supuestos text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select _q.* from (
with r as (select * from btg_resumen_socio(p_desde, p_hasta)),
       -- ⛔ SIN FILTRO DE FECHA, a propósito: lo pendiente es un saldo acumulado, no un flujo del
       -- período. Acotarlo escondía viajes viejos que siguen sin cobrarse.
       ej as (select coalesce(sum(t),0)::bigint v from planillas),
       fa as (select coalesce(sum(v),0)::bigint v from abonos),
       -- La tarifa VIGENTE: la de la última factura, no el promedio de todas.
       tar as (select coalesce((select round((m / nullif(v,0))::numeric, 2)
                                  from abonos where coalesce(v,0) > 0
                                 order by f desc, id desc limit 1), 0) t),
       pend as (select greatest(0, (select v from ej) - (select v from fa)) n),
       -- Ingresos totales: el mismo denominador que usa btg_resumen_socio para el margen real.
       ing as (select (select cobrado_usd from r) + (select otras_entradas_usd from r) v),
       fut as (select (select n from pend) * (select t from tar) v)
  select
    round((select utilidad_usd from r)::numeric, 2),
    round((select v from fut)::numeric, 2),
    (select n from pend),
    round(((select utilidad_usd from r) + (select v from fut))::numeric, 2),
    (select margen_pct from r),
    case when ((select v from ing) + (select v from fut)) > 0
      then round((((select utilidad_usd from r) + (select v from fut))
           / ((select v from ing) + (select v from fut)) * 100)::numeric, 1)
      else 0 end,
    (select t from tar),
    'Sin confirmar: (1) que todos los viajes de la planilla sean facturables a la Alcaldía, (2) que la tarifa de US$ ' ||
      (select t from tar) || ' aplique a todos, (3) que no haya un tope de lo que la Alcaldía reconoce por semana.'
  ) _q where public.btg_ve_financiero()
$function$;

CREATE OR REPLACE FUNCTION public.btg_donde_se_fue(p_desde text, p_hasta text)
 RETURNS TABLE(concepto text, usd numeric, pct numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with e as (
    select concepto, sum(usd) usd from btg_estado_financiero(p_desde,p_hasta)
     where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO')
     group by 1
  ), t as (select nullif(sum(usd),0) v from e)
  select e.concepto, round(e.usd,2), round((e.usd / (select v from t) * 100)::numeric,1)
    from e order by e.usd desc
  ) _q where public.btg_ve_financiero()
$function$;

CREATE OR REPLACE FUNCTION public.btg_donde_esta_utilidad(p_desde text, p_hasta text)
 RETURNS TABLE(orden integer, concepto text, usd numeric, nota text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with r as (select * from btg_resumen_socio(p_desde, p_hasta)),
       f as (select * from v_fondo_divisas),
       -- saldo actual de las cuentas en bolívares = el último saldo conocido de cada una
       sal as (
         select coalesce(sum(saldo),0) bs from (
           select cuenta, (saldo_anterior + case when tipo='credito' then monto else -monto end) saldo,
                  row_number() over (partition by cuenta order by fecha desc, control_number::bigint desc) rn
             from bnc_movimientos
            where saldo_anterior is not null and control_number ~ '^[0-9]+$'
         ) x where rn = 1
       ),
       th as (select btg_tasa_de(current_date) t)
  select 1, 'Se pasó a dólares (comprados en el período)',
         round((select comprado_usd from f)::numeric,2),
         'Bolívares que se convirtieron a moneda dura. De estos, parte ya se aplicó a la deuda de los camiones.'
  union all
  select 2, 'Sigue en bolívares, en las cuentas',
         round(((select bs from sal) / nullif((select t from th),0))::numeric,2),
         'Bs ' || round((select bs from sal)) || ' a la tasa de hoy. Es lo único que todavía se puede gastar directo.'
  union all
  select 3, 'Se vendieron dólares para cubrir nómina',
         round((select vendido_usd from f)::numeric,2),
         'Volvieron a bolívares y se gastaron: ya están dentro del gasto del período.'
  union all
  select 4, '⚠️ Diferencia por medir con tasas distintas',
         round((
           (select utilidad_usd from r)
           - (select comprado_usd from f)
           - ((select bs from sal) / nullif((select t from th),0))
           - (select vendido_usd from f)
         )::numeric,2),
         'Cada movimiento se mide a la tasa de SU día y el saldo final a la de HOY. Esa diferencia de método no es plata que falte ni que sobre: es el precio de medir en dólares una operación que ocurre en bolívares. NO es redondeo y por eso va como renglón propio.'
  order by 1
  ) _q where public.btg_ve_financiero()
$function$;

CREATE OR REPLACE FUNCTION public.btg_donde_estan_los_dolares()
 RETURNS TABLE(orden integer, concepto text, usd numeric, nota text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with f as (select * from v_fondo_divisas)
  select 1, 'Comprados dentro del período', round((select comprado_usd from f)::numeric,2),
         '16 operaciones, cada una a su tasa pactada (620 a 860), nunca a BCV.'
  union all
  select 2, 'Los que ya había antes del 23/03', 6000::numeric,
         'Saldo con que abre el fondo. Son anteriores al estado de cuenta, por eso el sistema solo puede verlos declarados.'
  union all
  select 3, 'Menos los vendidos para nómina', -round((select vendido_usd from f)::numeric,2),
         'Volvieron a bolívares para pagar sueldos.'
  union all
  select 4, '= COMPRADO EN TOTAL',
         round(((select comprado_usd from f) + 6000 - (select vendido_usd from f))::numeric,2),
         'Este es el número que lleva Máximo contado por su lado, y coincide al dólar.'
  union all
  select 5, 'Menos lo aplicado a la deuda de los camiones', -round((select a_deuda_usd from f)::numeric,2),
         'NO se gastó: se convirtió en menos deuda. Los dólares los compra Auto Unión y los aplica al crédito en el mismo acto.'
  union all
  select 6, '= QUEDA EN EL FONDO', round((select saldo_usd from f)::numeric,2),
         'En la cuenta de Alejandro Castillo. Es un activo de la empresa en manos de una persona.'
  order by 1
  ) _q where public.btg_ve_financiero()
$function$;

CREATE OR REPLACE FUNCTION public.btg_cambiario_mensual(p_desde text, p_hasta text)
 RETURNS TABLE(mes text, cobrado_usd numeric, parados_usd numeric, sobreprecio_usd numeric, total_usd numeric, pct_del_cobrado numeric, compras bigint, brecha_min_pct numeric, brecha_max_pct numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with
  -- saldo al cierre de cada día, y lo que pierde hasta el día siguiente
  cierres as (
    select d, saldo from (
      select fecha::date d,
             (saldo_anterior + case when tipo='credito' then monto else -monto end) saldo,
             row_number() over (partition by fecha::date order by control_number::bigint desc) rn
        from bnc_movimientos
       where saldo_anterior is not null and control_number ~ '^[0-9]+$'
         and cuenta = '01910031682131012653'
         and fecha >= p_desde and fecha <= p_hasta
    ) x where rn = 1
  ),
  conTasa as (
    select d, saldo, btg_tasa_de(d) t, lead(btg_tasa_de(d)) over (order by d) t2 from cierres
  ),
  parados as (
    select to_char(d,'YYYY-MM') m, sum(saldo * (1/t - 1/t2)) v
      from conTasa where t>0 and t2>0 and saldo>0 and t2>t group by 1
  ),
  compras as (
    select to_char(fecha::date,'YYYY-MM') m,
           sum(monto/btg_tasa_de(fecha::date) - monto/tasa_real) v,
           count(*) q,
           min(round((((tasa_real/btg_tasa_de(fecha::date))-1)*100)::numeric,1)) bmin,
           max(round((((tasa_real/btg_tasa_de(fecha::date))-1)*100)::numeric,1)) bmax
      from bnc_movimientos
     where categoria='compra_divisas' and tasa_real>0 and fecha >= p_desde and fecha <= p_hasta
     group by 1
  ),
  cobros as (
    select to_char(fecha::date,'YYYY-MM') m, sum(monto/btg_tasa_de(fecha::date)) v
      from bnc_movimientos
     where categoria='cobro_alcaldia' and tipo='credito' and fecha >= p_desde and fecha <= p_hasta
     group by 1
  ),
  meses as (
    select m from parados union select m from compras union select m from cobros
  )
  select
    x.m,
    round(coalesce(c.v,0)::numeric, 2),
    round(coalesce(p.v,0)::numeric, 2),
    round(coalesce(k.v,0)::numeric, 2),
    round((coalesce(p.v,0)+coalesce(k.v,0))::numeric, 2),
    case when coalesce(c.v,0) > 0
      then round(((coalesce(p.v,0)+coalesce(k.v,0)) / c.v * 100)::numeric, 2)
      else null end,
    coalesce(k.q,0),
    k.bmin, k.bmax
  from meses x
  left join parados p on p.m = x.m
  left join compras k on k.m = x.m
  left join cobros  c on c.m = x.m
  order by x.m
  ) _q where public.btg_ve_financiero()
$function$;

CREATE OR REPLACE FUNCTION public.btg_perdida_cambiaria(p_desde text, p_hasta text)
 RETURNS TABLE(orden integer, concepto text, usd numeric, evitable boolean, nota text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _q.* from (
with
  -- ── 1. el saldo al cierre de cada día, y lo que pierde hasta el día siguiente ──
  cierres as (
    select d, saldo from (
      select fecha::date d,
             (saldo_anterior + case when tipo='credito' then monto else -monto end) saldo,
             row_number() over (partition by fecha::date order by control_number::bigint desc) rn
        from bnc_movimientos
       where saldo_anterior is not null and control_number ~ '^[0-9]+$'
         and cuenta = '01910031682131012653'
         and fecha >= p_desde and fecha <= p_hasta
    ) x where rn = 1
  ),
  conTasa as (
    select d, saldo, btg_tasa_de(d) t,
           lead(d)   over (order by d) d2,
           lead(btg_tasa_de(d)) over (order by d) t2
      from cierres
  ),
  parados as (
    select coalesce(sum(saldo * (1/t - 1/t2)), 0) v
      from conTasa where t > 0 and t2 > 0 and saldo > 0 and t2 > t
  ),
  -- ── 2. lo que se pagó de más por los dólares, contra la tasa BCV del día ──
  sobre as (
    select coalesce(sum(monto/btg_tasa_de(fecha::date) - monto/tasa_real), 0) v,
           coalesce(sum(monto/tasa_real), 0) obtenidos,
           coalesce(sum(monto/btg_tasa_de(fecha::date)), 0) a_bcv
      from bnc_movimientos
     where categoria = 'compra_divisas' and tasa_real > 0
       and fecha >= p_desde and fecha <= p_hasta
  ),
  -- ── 3. lo que va a costar DE MÁS pagar la deuda que todavía queda ──
  -- ⚠️ La primera versión aplicaba la brecha a TODO lo cobrado y daba US$ 88.473 —el 101% de la
  -- utilidad—. Está mal por dos motivos: la nómina, el combustible y los servicios se pagan EN
  -- BOLÍVARES y ahí la brecha no existe; y sobre lo que ya se convirtió, la brecha ya está
  -- contada en el punto 2. Se contaría dos veces y asustaría con un número inventado.
  -- Lo que sí es cierto y no está en ningún lado: la deuda que FALTA pagar está en dólares, y
  -- esos dólares habrá que comprarlos al precio real, no a BCV.
  deuda as (
    select coalesce(monto_usd, 0) v from btg_posicion where clave = 'deuda_camiones'
  ),
  -- la brecha de la ÚLTIMA compra, que es la referencia más cercana a lo que costaría hoy
  ultima as (
    select coalesce((tasa_real / btg_tasa_de(fecha::date)) - 1, 0) pct
      from bnc_movimientos
     where categoria='compra_divisas' and tasa_real > 0 and not coalesce(tasa_estimada,false)
     order by fecha desc limit 1
  )
  select 1, 'Bolívares que se quedaron quietos perdiendo valor',
         round((select v from parados)::numeric, 2), true,
         'Solo cuenta mientras la plata está parada en la cuenta: el día que se compran dólares o se gasta, deja de perder. Que sea chico significa que la plata se mueve rápido.'
  union all
  select 2, 'Sobreprecio pagado por los dólares (contra BCV)',
         round((select v from sobre)::numeric, 2), false,
         'Se obtuvieron US$ ' || round((select obtenidos from sobre)) || ' donde a tasa BCV serían US$ ' || round((select a_bcv from sobre)) ||
         '. NO es evitable: a tasa BCV no se pueden comprar dólares, ese mercado no existe. Es el precio real de la moneda dura.'
  union all
  -- ⛔ NO SE PROYECTA CON UN PROMEDIO. Máximo: «la brecha del sobreprecio no puedes hacerla en
  -- línea a un porcentaje sino uno a uno cada vez que se compra, porque la brecha baja y sube».
  -- Medido: fue 31,9% el 14/04, subió a 35,6% el 09/06 y bajó a 14,0% el 30/07. Un promedio del
  -- 27% no describe ninguna compra real y, peor, BORRA la única señal útil: que está bajando.
  -- Por eso la referencia es la brecha de la ÚLTIMA compra, y se dice que es referencia.
  select 3, '⏳ Referencia: sobreprecio de la deuda a la brecha de la ÚLTIMA compra',
         round(((select v from deuda) * (select pct from ultima))::numeric, 2), false,
         'NO es un pronóstico. La brecha SUBE Y BAJA (fue 35,6% el 09/06 y 14,0% el 30/07), así que ' ||
         'proyectar con un promedio inventa un número. Esto es solo la referencia de cuánto costaría ' ||
         'de más la deuda que queda (US$ ' || round((select v from deuda)) || ') SI la brecha se mantuviera en el ' ||
         round(((select pct from ultima)*100)::numeric,1) || '% de la última compra. El costo real se sabrá compra por compra.'
  order by 1
  ) _q where public.btg_ve_financiero()
$function$;
