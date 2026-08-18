-- ============================================================================
-- LAS 40 CARGAS QUE SE QUEDARON EN EL DESPACHO VIEJO  ·  18/08/2026
--
-- Qué son: 40 filas de `gasoil` (22/07 → 01/08), 6.862 L, US$ 3.792,65, de
-- 10 camiones, todas `tipo_operacion='despacho'` y `src='Estacion'`. Son
-- cargas REALES que se registraron por «Despacho a Camión» —el camino que el
-- 18/08 quedó de solo lectura— y que el chofer nunca anotó en `surtidas`.
-- Mientras vivan solo en `gasoil`, el consumo por unidad de esas tres semanas
-- no se puede calcular: el motor lee `surtidas`.
--
-- ⛔ NO SE HACEN PASAR POR REGISTRO DEL CHOFER. Máximo lo decidió así: entran
--    con `origen='oficina-despacho-viejo'`, sin foto (no la tomó nadie) y con
--    la nota que dice de qué fila de `gasoil` salió cada una. Se distinguen
--    para siempre de lo que un chofer sí paró a registrar, y se deshacen
--    filtrando por esa marca.
--
-- 💵 TRAEN SU PROPIO DINERO, y esto fue el hallazgo: `gasoil.m` guardaba el
--    monto en dólares de cada carga, y sale a precios limpios —US$ 0,50 / 0,55
--    / 0,75 por litro, las 40 sin excepción—. O sea que el pendiente «El
--    Palotal: 1.050 L sin costear» estaba costeado desde el principio, en la
--    columna de al lado. Es la MISMA lección del 17/08 con `surtidas`: antes de
--    salir a buscar el dato, preguntarle a la tabla que ya lo tenía.
--
-- ⚠️ EL CHOFER SE DERIVA, NO SE INVENTA. Sale de `checklist` (quién manejaba
--    ESE camión ESE día). Alcanza para 33 de las 40; las otras 7 no tienen
--    checklist ese día y quedan con `chofer` en NULL. Ponerles un nombre
--    probable sería fabricar un dato que nadie declaró.
--
-- Comprobado antes de correr:
--   · `checklist` no tiene duplicados cam+fecha → el join no multiplica filas.
--   · `surtidas` no tiene disparadores (con control positivo: la misma consulta
--     sí los encuentra en `combustible_mediciones` y otras 7 tablas).
--   · el único cam+fecha de la ventana que YA tenía surtida es JAC-B004 del
--     01/08 (180 L contra 180,31): una sola carga, un solo registro. El corte
--     da exactamente 40 y no se pisa nada.
--
-- Idempotente: el `where not exists` y el id derivado (`MIG-G<id>`) hacen que
-- re-correrla no duplique.
-- ============================================================================

-- ── 1. La marca de origen ────────────────────────────────────────────────────
-- Hasta hoy TODA fila de `surtidas` entró por `surtida_registrar` desde la app
-- del chofer: por eso el relleno a 'chofer' no es una suposición, es lo que
-- había. Sin relleno, un NULL no distinguiría «lo cargó el chofer» de «no se
-- sabe», que es justo lo que esta columna viene a evitar.
alter table surtidas add column if not exists origen text;
update surtidas set origen = 'chofer' where origen is null;
alter table surtidas alter column origen set default 'chofer';

comment on column surtidas.origen is
  'Quién produjo la fila: ''chofer'' = la registró él en ⛽ Surtir. '
  '''oficina-despacho-viejo'' = la cargó la oficina migrando el card «Despacho a '
  'Camión», sin foto y con el chofer derivado del checklist. Sirve para no leer '
  'como cumplimiento del chofer algo que el chofer no hizo.';

-- ── 2. Las 40 filas ──────────────────────────────────────────────────────────
insert into surtidas (
  id, fecha, hora, cam, chofer, tanque, litros,
  costo_litro_usd, costo_usd, costo_definido,
  foto_url, nota, origen, estacion_nombre
)
select
  'MIG-G' || g.id,
  g.f::date,
  null,                                   -- `gasoil` no guarda hora: no se inventa
  g.cam,
  ch.conductor,                           -- NULL en 7 de las 40, a propósito
  'estacion',
  g.lit,
  round(g.m::numeric / nullif(g.lit,0), 4),
  round(g.m::numeric, 2),
  true,                                   -- viene costeada: el monto es dato, no estimación
  null,                                   -- sin foto, y que se note
  'Migrada del despacho viejo (gasoil #' || g.id || ') el 18/08/2026. '
    || case when ch.conductor is null
            then 'Sin checklist ese día: no consta quién manejaba.'
            else 'Chofer derivado del checklist de ese día.' end,
  'oficina-despacho-viejo',
  g.src
from gasoil g
left join checklist ch on ch.cam = g.cam and ch.fecha = g.f
where g.f::date between '2026-07-22' and '2026-08-01'
  and not exists (
    select 1 from surtidas s where s.cam = g.cam and s.fecha = g.f::date
  )
on conflict (id) do nothing;
