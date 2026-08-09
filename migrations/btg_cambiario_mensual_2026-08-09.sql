-- ============================================================================
-- Betangar · EL DIFERENCIAL CAMBIARIO, MES A MES
-- 2026-08-09. Máximo: «ese factor me gusta llevarlo, el porcentaje que se
-- perdió por el diferencial cambiario mes a mes, me gustaría tener ese número
-- a la mano».
--
-- LA BASE DEL PORCENTAJE ES LO COBRADO DEL MES: «de cada 100 dólares que
-- entraron, cuántos se perdieron por el cambio». Es la lectura que sirve para
-- decidir; medirlo contra la utilidad lo haría saltar de mes a mes por razones
-- que no tienen que ver con el cambio.
--
-- ⚠️ SE MUESTRAN LAS DOS PIEZAS POR SEPARADO, porque se controlan distinto:
--   · bolívares parados → depende de cuánto tarda la plata en moverse. SE PUEDE
--     mejorar: comprar antes, pagar antes.
--   · sobreprecio de la compra → es el precio del mercado ese día. NO se
--     controla, pero sí se puede ELEGIR CUÁNDO comprar: la brecha fue 35,6% el
--     09/06 y 14,0% el 30/07.
--
-- ⛔ La brecha del mes se muestra como MÍNIMA y MÁXIMA, no como promedio.
-- Máximo: «la brecha baja y sube». Un promedio esconde que en el mismo mes hubo
-- compras al 27% y al 35%, que es justo lo que hay que ver.
-- ============================================================================

create or replace function btg_cambiario_mensual(p_desde text, p_hasta text)
returns table (
  mes              text,
  cobrado_usd      numeric,
  parados_usd      numeric,   -- bolívares quietos perdiendo valor
  sobreprecio_usd  numeric,   -- lo pagado de más al comprar dólares
  total_usd        numeric,
  pct_del_cobrado  numeric,   -- ← el número que pidió Máximo
  compras          bigint,
  brecha_min_pct   numeric,
  brecha_max_pct   numeric
)
language sql
security definer
set search_path = public
as $$
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
$$;

revoke all on function btg_cambiario_mensual(text,text) from anon, public;
grant execute on function btg_cambiario_mensual(text,text) to authenticated;

comment on function btg_cambiario_mensual is
  'El diferencial cambiario mes a mes, con el % sobre lo cobrado: «de cada 100 dólares que entraron, cuántos se perdieron por el cambio». Las dos piezas van separadas porque se controlan distinto, y la brecha va como mínima/máxima porque promediarla esconde que en el mismo mes hubo compras muy distintas.';
