-- ============================================================================
-- Betangar · LO QUE CUESTA EL DIFERENCIAL CAMBIARIO — tres cosas distintas
-- 2026-08-09.
--
-- Máximo: «esa pérdida ya la estimamos, solo es bueno registrarla». Va como
-- MÉTRICA, no dentro del estado de resultados: la utilidad sigue siendo la que
-- es, y esto se muestra al lado para que el socio sepa leerla.
--
-- ⛔ SON TRES COSAS Y SE CONFUNDEN FÁCIL. Yo mismo las mezclé y presenté un
-- número 7 veces inflado. Máximo lo cortó: *«al comprar los dólares ya no
-- deberían seguirse devaluando esos bolívares, cierra su ciclo ahí»*.
--
--  1. BOLÍVARES PARADOS PERDIENDO VALOR
--     Solo corre MIENTRAS la plata está quieta en la cuenta. El día que se
--     compran dólares o se gasta, ese saldo deja de perder. Medido día a día
--     da US$ 3.364 en 4 meses y medio — chico, y eso es una buena noticia:
--     significa que la plata se mueve rápido. Mi primer cálculo daba 24.600
--     porque medía TODA la utilidad como si hubiera quedado en bolívares.
--
--  2. SOBREPRECIO AL COMPRAR DÓLARES (contra BCV)
--     Se compra a 620–860 cuando el BCV dice 477–747: US$ 19.489 en 16
--     operaciones, 21,5%. ⚠️ NO es un costo evitable ni un mal negocio: **a
--     tasa BCV no se pueden comprar dólares**, ese mercado no existe. Es el
--     precio real de la moneda dura.
--
--  3. LA BRECHA DEL CONTRATO ← el grande, y el que no se ve en ningún lado
--     Máximo: *«la alcaldía me paga a BCV dólar»*. Se cobra en bolívares
--     convertidos a BCV, pero la deuda de los camiones está EN DÓLARES y esos
--     dólares cuestan 21,5% más. O sea: se cobra en una moneda que compra
--     menos de lo que dice el papel. Cada cuota de US$ 23.417 cuesta en
--     realidad ≈ US$ 28.450 de poder de compra.
--     Esto NO es ineficiencia de nadie: es la estructura del contrato.
-- ============================================================================

create or replace function btg_perdida_cambiaria(p_desde text, p_hasta text)
returns table (
  orden    int,
  concepto text,
  usd      numeric,
  evitable boolean,
  nota     text
)
language sql
security definer
set search_path = public
as $$
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
  select 3, '⏳ Sobreprecio que FALTA pagar por la deuda en dólares',
         round(((select v from deuda) * (case when (select obtenidos from sobre) > 0
                then (select a_bcv from sobre)/(select obtenidos from sobre) - 1 else 0 end))::numeric, 2), false,
         'NO es una pérdida del período: es lo que va a costar DE MÁS comprar los dólares de la deuda que todavía queda (US$ ' ||
         round((select v from deuda)) || '). La Alcaldía paga a BCV pero la deuda está en dólares y esos dólares cuestan más. ' ||
         'Cada cuota de US$ 23.417 se lleva en realidad ese porcentaje más de poder de compra. Es la estructura del contrato, no ineficiencia de nadie.'
  order by 1
$$;

revoke all on function btg_perdida_cambiaria(text,text) from anon, public;
grant execute on function btg_perdida_cambiaria(text,text) to authenticated;

comment on function btg_perdida_cambiaria is
  'Las tres pérdidas por diferencial cambiario, separadas porque se confunden fácil. `evitable` distingue la que depende de cómo se maneja la plata (bolívares parados) de las que son el precio del mercado o del contrato.';
