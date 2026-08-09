-- ============================================================================
-- Betangar · LA PÉRDIDA CAMBIARIA ENTRA AL ESTADO DE RESULTADOS
-- 2026-08-09. Decisión de Máximo: «una pérdida en el estado de resultados».
--
-- QUÉ ENTRA Y QUÉ NO — y esto no es un detalle contable, cambia el número que
-- lee el socio:
--
--  ✅ ENTRA · Bolívares parados perdiendo valor        US$  3.364
--     Ya ocurrió. Es plata que la empresa tenía y dejó de tener, sin que nadie
--     la gastara. Se calcula día a día y solo mientras el saldo está quieto.
--
--  ✅ ENTRA · Sobreprecio pagado por los dólares        US$ 19.489
--     Ya se pagó. Se compró a 620–860 lo que a BCV valía 477–747. Es un costo
--     financiero real del período, aunque no sea evitable.
--
--  ⛔ NO ENTRA · Sobreprecio futuro de la deuda        US$ 102.267
--     TODAVÍA NO OCURRIÓ. Y la brecha sube y baja —35,6% en junio, 14,0% en
--     julio— así que ni siquiera se sabe cuánto será. Cargarlo al período sería
--     restarle a esta ganancia un gasto que no pasó, y con un número que no se
--     puede calcular. Va en la POSICIÓN, como compromiso futuro.
--     [[norma-documento-no-afirma-lo-que-nadie-declaro]]
--
-- Efecto: la utilidad pasa de US$ 110.567 a US$ 87.714. Ese es el número que
-- refleja lo que la empresa se quedó de verdad, en moneda que compra.
-- ============================================================================

drop function if exists btg_resumen_socio(text,text);

create or replace function btg_resumen_socio(p_desde text, p_hasta text)
returns table (
  cobrado_usd        numeric,
  otras_entradas_usd numeric,
  gasto_usd          numeric,
  cambiario_usd      numeric,     -- la pérdida cambiaria REALIZADA del período
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
$$;

revoke all on function btg_resumen_socio(text,text) from anon, public;
grant execute on function btg_resumen_socio(text,text) to authenticated;

comment on function btg_resumen_socio is
  'Lo que un socio pregunta, en una línea. `cambiario_usd` es la pérdida por diferencial YA REALIZADA (bolívares que perdieron valor + sobreprecio pagado por los dólares) y se resta de la utilidad. El sobreprecio FUTURO de la deuda no entra: no ocurrió y la brecha sube y baja.';

-- El compromiso futuro va a la posición, que es donde se muestran las cosas que
-- todavía no pasaron pero hay que tener presentes.
insert into btg_posicion (clave, titulo, grupo, monto_usd, vigente_al, declarado_por, nota, supuesto)
select 'sobreprecio_deuda', '⏳ Sobreprecio estimado para comprar los dólares de la deuda', 'DEUDA',
       round(p.usd::numeric,2), current_date, 'Cálculo sobre la brecha de la última compra',
       'NO es una pérdida del período ni un pronóstico: es la referencia de cuánto costaría de más la deuda que queda SI la brecha se mantuviera como en la última compra. La brecha sube y baja (35,6% en junio, 14,0% en julio), así que el costo real se sabrá compra por compra.',
       true
  from btg_perdida_cambiaria('2026-03-23', current_date::text) p
 where p.orden = 3
on conflict (clave) do update
  set monto_usd=excluded.monto_usd, vigente_al=excluded.vigente_al, nota=excluded.nota, updated_at=now();
