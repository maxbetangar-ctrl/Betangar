-- BETANGAR — GPS: declarar la columna `ubicacion`, que la base YA TIENE y el repo no decía
-- Fecha: 2026-10-30
--
-- ⛔ QUÉ SE ARREGLA: `public.gps_posiciones.ubicacion` (text) EXISTE en la base de
--    producción y está en pleno uso — medido el 30/10/2026: **319.427 de 319.439 filas la
--    tienen llena** (99,99%), con 1.672 valores distintos. La escribe el conector, en
--    `supabase/functions/gps-sondeo/index.ts:196`, desde el campo `Location` del proveedor:
--        ubicacion: String(d.Location || "").split("~")[0].trim() || null
--    Y la LEEN dos validaciones de polígonos: `parroquias_maracaibo_2026-10-22.sql:149` y
--    `parroquias_recortadas_costa_2026-10-23.sql`.
--
--    Pero NINGUNA migración la declaraba. `gps_posiciones_2026-08-13.sql` crea la tabla sin
--    ella. Se agregó a mano a la base en algún momento y el repo nunca lo supo.
--
-- ⚠️ POR QUÉ IMPORTA, aunque hoy no rompa nada acá: el repo deja de describir la base. El
--    día que se clone la empresa (`CLONAR_EMPRESA.md`) la base nueva NO va a tener la
--    columna, y entonces:
--      1. el `insert` del conector falla por columna inexistente — y un insert que falla se
--         lleva la FILA ENTERA, así que ese clon no guarda NINGUNA posición, no solo pierde
--         el nombre del sitio;
--      2. los dos bloques que VALIDAN los polígonos de parroquia revientan — y sobre esos
--         polígonos se construyeron las 34 zonas de recolección.
--    Un campo que no existe se lee igual que uno vacío: el clon diría «sin posiciones para
--    comprobar» y eso parecería una base nueva y limpia, no una rota.
--
-- Esta migración NO cambia nada en Betangar: `if not exists` la vuelve un no-op acá. Su
-- trabajo es que el repo diga la verdad y que el próximo clon nazca completo.

begin;

alter table public.gps_posiciones
  add column if not exists ubicacion text;

comment on column public.gps_posiciones.ubicacion is
  'Nombre del sitio como lo geocodifica EL PROVEEDOR (campo Location, antes del "~"). '
  'Lo escribe gps-sondeo. ⛔ No es nuestro: es texto libre de un tercero, puede venir nulo, '
  'cambiar de forma sin avisar y traer la parroquia escrita de otra manera. Sirve para '
  'mostrar y para cotejar, NO para decidir: para saber en qué parroquia o zona cayó una '
  'posición manda el polígono (zona_en_punto / _punto_en_poligono), no este texto.';

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='gps_posiciones' and column_name='ubicacion';
--   → una fila: ubicacion | text
-- select count(*) total, count(ubicacion) con_ubicacion from public.gps_posiciones;
--   → en Betangar, con_ubicacion ≈ total. En un clon recién nacido, 0 y 0 (correcto).
