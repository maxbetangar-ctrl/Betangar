-- ═══════════════════════════════════════════════════════════════════════════════
-- LA TARIFA TIENE FECHA — 2026-11-04
--
-- ⛔ ESTA MIGRACIÓN REVIERTE LA PREMISA DE `descuento_pronto_pago_2026-10-26.sql`.
--    Aquella se escribió con esto, dicho por Máximo el 26/10:
--      «todo sigue siendo a 39 sin complicación y solo al momento del pago hago un
--       descuento por pronto pago o abono grande»
--    ⇒ el viaje valía SIEMPRE 39,61/t y la concesión vivía en el ABONO.
--
--    Máximo, 04/11/2026: «esas 2 son tarifas distintas, configura que a partir del
--    primer lunes de octubre es una tarifa distinta, es 32,65$ la tonelada es decir
--    261,2$ el viaje» · «para atrás sí es la tarifa vieja».
--    Se le planteó la contradicción con los números que mueve y respondió
--    «usa lo que te digo hoy». ⇒ NO era un descuento: es el precio, y tiene fecha.
--
-- EL PRIMER LUNES DE OCTUBRE DE 2026 ES EL **LUNES 05/10** (el 1 cayó jueves).
--
-- QUÉ CAMBIA, MEDIDO ANTES DE TOCAR (2.257 planillas):
--   · hasta el 04/10 → 1.947 planillas, 4.770 viajes, US$ 1.511.517,60 — NO se tocan
--   · desde el 05/10 →   310 planillas,   778 viajes, US$   246.532,64 guardados a
--     316,88 cuando tocan 261,20 ⇒ US$ 203.213,60. Diferencia **−US$ 43.319,04**.
--   La utilidad real NO se mueve: sale del banco, no de la tarifa.
--
-- ⛔ POR QUÉ UNA TABLA Y NO UN NÚMERO. `configuracion.tarifa_contrato_ton` es un
--    valor suelto sin fecha: el mismo defecto que el `localStorage` que esto ya
--    arregló una vez. Un valor DERIVADO (el monto de la planilla) depende de la
--    VERSIÓN de su regla, así que la regla se guarda con su vigencia y el monto se
--    saca de una función, no de un número que alguien pisa.
--    [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
-- ⛔ REVERSIBLE: el UNDO está al final del archivo. Las 310 filas se respaldan en
--    `configuracion` bajo `backup_planillas_tarifa_2026-11-04`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) La regla, con su vigencia ───────────────────────────────────────────────
create table if not exists public.tarifas_contrato (
  desde           date primary key,
  usd_por_ton     numeric(12,4) not null check (usd_por_ton > 0),
  tons_por_viaje  numeric(8,3)  not null default 8 check (tons_por_viaje > 0),
  nota            text,
  created_at      timestamptz not null default now()
);

comment on table public.tarifas_contrato is
  'La tarifa del contrato de aseo con su VIGENCIA. El monto de una planilla se valora con la tarifa que regia EL DIA DEL VIAJE, no con la de hoy. Se guarda por tonelada porque asi se negocia; el viaje son 8 t. Ver migrations/tarifa_por_fecha_2026-11-04.sql';

insert into public.tarifas_contrato (desde, usd_por_ton, tons_por_viaje, nota) values
  (date '2026-01-01', 39.61, 8, 'Tarifa original del contrato: 39,61/t x 8 t = 316,88 por viaje.'),
  (date '2026-10-05', 32.65, 8, 'Primer lunes de octubre de 2026. 32,65/t x 8 t = 261,20 por viaje. Declarada por Maximo el 04/11/2026; reemplaza el modelo de descuento por pronto pago del 26/10.')
on conflict (desde) do update
  set usd_por_ton = excluded.usd_por_ton,
      tons_por_viaje = excluded.tons_por_viaje,
      nota = excluded.nota;

-- ── 2) La fuente única para valorar un viaje ───────────────────────────────────
create or replace function public.btg_tarifa_viaje(p_fecha date)
returns numeric
language sql
stable
set search_path to 'public'
as $fn$
  select round(t.usd_por_ton * t.tons_por_viaje, 2)
    from public.tarifas_contrato t
   where t.desde <= p_fecha
   order by t.desde desc
   limit 1
$fn$;

comment on function public.btg_tarifa_viaje(date) is
  'Lo que vale UN viaje en una fecha dada, segun tarifas_contrato. 316,88 hasta el 04/10/2026 y 261,20 desde el 05/10/2026. Si la fecha es anterior a la primera vigencia devuelve null: un viaje sin tarifa NO se valora en cero.';

-- ── 3) Respaldo ANTES de tocar nada ────────────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_planillas_tarifa_2026-11-04',
       coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'p', p.p, 'f', p.f, 't', p.t, 'm', p.m)
                          order by p.id)::text, '[]')
  from public.planillas p
 where p.f >= '2026-10-05'
on conflict (clave) do update set valor = excluded.valor, updated_at = now();

-- ── 4) Las planillas, a la tarifa que les tocaba ───────────────────────────────
-- Solo las de 05/10 en adelante, y solo si el monto cambia. `coalesce` no: si la
-- funcion no sabe la tarifa, la fila NO se toca.
update public.planillas p
   set m = round(p.t * public.btg_tarifa_viaje(p.f::date), 2)
 where p.f >= '2026-10-05'
   and public.btg_tarifa_viaje(p.f::date) is not null
   and p.m is distinct from round(p.t * public.btg_tarifa_viaje(p.f::date), 2);

-- ── 5) El «descuento» de los abonos 000651 y 000652 deja de serlo ──────────────
-- A 261,20 el viaje, 165 x 261,20 = 43.098,00 = EXACTAMENTE lo que pago la
-- Alcaldia en cada uno. No hubo concesion: era el precio.
update public.abonos
   set descuento = false
 where fact in ('000651','000652')
   and descuento is true;

-- ── 6) La tarifa suelta queda apuntando a la vigente ───────────────────────────
-- app.js todavia lee `tarifa_contrato_ton` para la planilla NUEVA. Mientras no
-- lea la funcion por fecha, el valor correcto para lo que se cargue de hoy en
-- adelante es el vigente. ⛔ Ojo: con esto, EDITAR una planilla vieja la volveria
-- a guardar a 261,20. Eso lo cierra el cambio de app.js, no esta migracion.
update public.configuracion
   set valor = '32.65', updated_at = now()
 where clave = 'tarifa_contrato_ton';

-- ── Comprobacion ───────────────────────────────────────────────────────────────
select 'planillas desde 05/10' etiqueta,
       count(*) filas, sum(t) viajes, round(sum(m),2) monto,
       string_agg(distinct round(m/nullif(t,0),2)::text, ', ') tarifas
  from public.planillas where f >= '2026-10-05'
union all
select 'planillas hasta 04/10', count(*), sum(t), round(sum(m),2),
       string_agg(distinct round(m/nullif(t,0),2)::text, ', ')
  from public.planillas where f < '2026-10-05';

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO (pegar y correr si hay que volver atras)
-- ═══════════════════════════════════════════════════════════════════════════════
-- update public.planillas p set m = (b.v->>'m')::numeric
--   from (select jsonb_array_elements(valor::jsonb) v
--           from public.configuracion
--          where clave = 'backup_planillas_tarifa_2026-11-04') b
--  where p.id = (b.v->>'id')::bigint;
-- update public.abonos set descuento = true where fact in ('000651','000652');
-- update public.configuracion set valor = '39.61' where clave = 'tarifa_contrato_ton';
-- delete from public.tarifas_contrato where desde = date '2026-10-05';
-- ═══════════════════════════════════════════════════════════════════════════════
