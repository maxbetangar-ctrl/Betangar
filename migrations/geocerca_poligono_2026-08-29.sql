-- BETANGAR — Las geocercas dejan de ser círculos: se dibujan por sus ESQUINAS
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Máximo marcó RECIMARA con el círculo de siempre y quedó mal:
-- *«MARQUÉ RECIMARA EN EL MAPA PERO AMPLIÓ MUCHO A LA REDONDA Y NO ES ASÍ»*, y después
-- lo de fondo: *«casi ningún punto es un círculo»*.
--
-- Tiene razón, y se mide: con 800 m de radio, RECIMARA agarra 66 posiciones repartidas
-- en un área de **536 m** alrededor del centro — no es un terreno, es media zona, con
-- avenidas adentro que no son el sitio. Y esa geocerca decide algo que importa: si una
-- parada de un camión cuenta como **descarga en el vertedero** o como **parada de
-- recolección en ruta**, que es el número que se le muestra a la Alcaldía. Un círculo de
-- más convierte recolección en descarga sin que nadie lo note.
--
-- QUÉ CAMBIA. Columna `poligono` (jsonb): un arreglo de vértices `[[lat,lng],...]` con
-- las esquinas del sitio. Cuando existe, es ÉL quien decide si un punto está adentro.
--
-- ⛔ `lat`, `lng` y `radio_m` NO se van, y no es por compatibilidad perezosa:
--  · `app.js` (Configuración → Sitios) los muestra y los usa para el QR de sucursal, y
--    `fichar.html` lee de la misma tabla. Una columna nueva que el código viejo ignora
--    no rompe nada; una columna vieja que se vacía, sí.
--  · Al guardar un polígono se recalculan como el **círculo que lo ENVUELVE** (centro =
--    centroide, radio = distancia al vértice más lejano). Así lo viejo sigue viendo un
--    círculo coherente con el terreno, y **nunca más chico** — si fuera más chico, alguien
--    que hoy ficha dejaría de poder fichar mañana, y ese es justo el candado que rompe la
--    herramienta.
--  · O sea: el círculo es la aproximación de siempre, el polígono es la verdad. Quien
--    entiende el polígono lo usa; quien no, no empeora.
--
-- ⚠️ Lo que NO hace este archivo: arreglar RECIMARA. El polígono lo tiene que dibujar
-- alguien que sepa dónde están las esquinas del terreno — no se deduce del GPS, y
-- deducirlo fue justamente lo que dejó el vertedero «SIN CONFIRMAR» dos semanas.
--
-- Reversa al final.

begin;

alter table public.sitios_asistencia
  add column if not exists poligono jsonb;

comment on column public.sitios_asistencia.poligono is
  'Esquinas del sitio: [[lat,lng],[lat,lng],...] en orden, sin repetir la primera al '
  'final (se cierra sola). Cuando está, es la que decide si un punto está adentro. '
  'NULL = el sitio sigue siendo el círculo lat/lng/radio_m.';
comment on column public.sitios_asistencia.radio_m is
  'Radio del círculo del sitio. Si hay `poligono`, este círculo es el que lo ENVUELVE '
  '(centro = centroide, radio = vértice más lejano): lo mantiene el código que guarda el '
  'polígono, para que lo que todavía lee círculos no quede con una geocerca más chica '
  'que el terreno.';

-- Un polígono de menos de 3 vértices no encierra nada, y uno gigante es casi siempre un
-- clic perdido. El candado deja gracia de sobra: 200 vértices es muchísimo más de lo que
-- nadie va a marcar a mano.
alter table public.sitios_asistencia
  drop constraint if exists sitios_poligono_valido;
alter table public.sitios_asistencia
  add constraint sitios_poligono_valido check (
    poligono is null or (
      jsonb_typeof(poligono) = 'array'
      and jsonb_array_length(poligono) between 3 and 200
    )
  );

commit;

-- ============================================================================
-- REVERSA:
--   alter table public.sitios_asistencia drop constraint if exists sitios_poligono_valido;
--   alter table public.sitios_asistencia drop column poligono;
-- (Los círculos quedan como están: nunca se dejaron de mantener.)
-- ============================================================================
