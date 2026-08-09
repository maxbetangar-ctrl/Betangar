-- ============================================================================
-- Betangar · LA UTILIDAD REAL Y LA ESTIMADA
-- 2026-08-09. Máximo: «que el informe mensual también tome en cuenta los
-- 500.000$ que todavía nos debe la Alcaldía de viajes no facturados pero sí
-- ejecutados, pero explicado de una forma que diga el real y el estimado — que
-- sería este cuando se facture y cobre ese dinero que ya se ejecutó con los
-- gastos que ya tienes».
--
-- POR QUÉ HACEN FALTA LAS DOS, Y NO UNA SOLA:
--
--  · UTILIDAD REAL = lo que entró menos lo que salió. Es la plata que existe.
--    Es la que manda para decidir si se puede pagar algo.
--
--  · UTILIDAD ESTIMADA = la real MÁS lo que ya se trabajó y no se ha facturado.
--    Los gastos de esos 1.784 viajes YA SE PAGARON —nómina, combustible,
--    mantenimiento— y están todos dentro de la utilidad real, restando. Pero su
--    ingreso no entró. O sea: **la utilidad real está subestimada**, porque
--    carga el costo de un trabajo cuyo cobro todavía no aparece.
--
-- ⚠️ Y LA ESTIMADA NO SE PRESENTA COMO UN HECHO. En Venezuela no se factura
-- hasta el momento del pago por el diferencial cambiario, así que nadie sabe
-- CUÁNDO se cobra — y con el Estado, menos. Además descansa en tres supuestos
-- que Máximo todavía no confirmó:
--    1. ¿todos los viajes de la planilla son facturables a la Alcaldía?
--    2. ¿la tarifa de US$ 316,88 aplica a todos?
--    3. ¿hay un tope de lo que la Alcaldía reconoce por semana?
-- Por eso viaja marcada como estimada y con los supuestos escritos. Un número
-- así, mostrado como certeza, es exactamente lo que hace que un socio tome una
-- decisión sobre plata que no existe todavía.
-- [[norma-viajes-ejecutados-no-facturados]]
-- ============================================================================

create or replace function btg_utilidad_real_y_estimada(p_desde text, p_hasta text)
returns table (
  utilidad_real_usd      numeric,   -- la plata que existe
  por_facturar_usd       numeric,   -- trabajo hecho, sin facturar
  viajes_sin_facturar    bigint,
  utilidad_estimada_usd  numeric,   -- la real + lo que falta cobrar de lo ya trabajado
  margen_real_pct        numeric,
  margen_estimado_pct    numeric,
  tarifa_usada           numeric,
  supuestos              text
)
language sql
security definer
set search_path = public
as $$
  with r as (select * from btg_resumen_socio(p_desde, p_hasta)),
       -- viajes EJECUTADOS (planillas) vs FACTURADOS (abonos), en el período
       ej as (select coalesce(sum(t),0)::bigint v from planillas where f >= p_desde and f <= p_hasta),
       fa as (select coalesce(sum(v),0)::bigint v from abonos where f >= p_desde and f <= p_hasta),
       -- la tarifa sale de las propias facturas, no de una constante: monto ÷ viajes
       tar as (select case when coalesce(sum(v),0) > 0 then round((sum(m)/sum(v))::numeric,2) else 0 end t
                 from abonos where f >= p_desde and f <= p_hasta and coalesce(v,0) > 0),
       pend as (select greatest(0, (select v from ej) - (select v from fa)) n)
  select
    round((select utilidad_usd from r)::numeric, 2),
    round(((select n from pend) * (select t from tar))::numeric, 2),
    (select n from pend),
    round(((select utilidad_usd from r) + (select n from pend) * (select t from tar))::numeric, 2),
    (select margen_pct from r),
    case when ((select cobrado_usd from r) + (select n from pend)*(select t from tar)) > 0
      then round((((select utilidad_usd from r) + (select n from pend)*(select t from tar))
           / ((select cobrado_usd from r) + (select n from pend)*(select t from tar)) * 100)::numeric, 1)
      else 0 end,
    (select t from tar),
    'Sin confirmar: (1) que todos los viajes de la planilla sean facturables a la Alcaldía, (2) que la tarifa de US$ ' ||
      (select t from tar) || ' aplique a todos, (3) que no haya un tope de lo que la Alcaldía reconoce por semana.'
$$;

revoke all on function btg_utilidad_real_y_estimada(text,text) from anon, public;
grant execute on function btg_utilidad_real_y_estimada(text,text) to authenticated;

comment on function btg_utilidad_real_y_estimada is
  'Las DOS utilidades: la REAL (plata que existe) y la ESTIMADA (la real más el trabajo ya ejecutado y no facturado, cuyos gastos YA están restados). La estimada va siempre marcada y con sus supuestos: no se factura hasta el momento del pago, así que nadie sabe cuándo entra.';
