-- ═══════════════════════════════════════════════════════════════════════════════
-- cola_mensajes.tomado_at — separar "lo tomé" de "lo envié"
-- 2026-08-07
-- ═══════════════════════════════════════════════════════════════════════════════
-- `enviado_at` hacía DOS trabajos a la vez en procesar_cola_wassenger:
--   1. marca de RECLAMO: al tomar la fila se escribía `estado='enviando', enviado_at=now()`,
--      y la recuperación de trabados usaba `.lt('enviado_at', hace10min)`.
--   2. fecha de ENVÍO: al salir bien se volvía a escribir.
--
-- Consecuencia: si el envío fallaba, la fila volvía a 'pendiente' pero se QUEDABA con la
-- fecha del reclamo. Quedaba diciendo "enviado_at: 13:36" algo que nunca salió.
-- Pasó hoy, real: el recordatorio a Alejandra (id 2309) mostraba enviado_at con un 502 de
-- Wassenger adentro y estado 'pendiente'. Quien mire esa fecha da por hecho que llegó.
--
-- Arreglo: `tomado_at` para el reclamo; `enviado_at` SOLO cuando se envió de verdad.
--
-- Va en las 4 bases que tienen la tabla: Betangar (hrkjddehqnzcqwlkklqm), Flotilla
-- (mcvizzknpqrggohbohcw), flotamax-demo (mogntbltkkdtyojrchvh) y VIDECA
-- (mmofoizzzpcnqhmzkevm). flotamax-demo-nuevo ya no existe en Supabase.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.cola_mensajes add column if not exists tomado_at timestamptz;

comment on column public.cola_mensajes.tomado_at is
  'Cuándo el worker RECLAMÓ la fila (estado=enviando). Sirve para recuperar mensajes trabados. No es la fecha de envío: esa es enviado_at y solo se escribe al salir bien.';

-- 1) Preservar el reclamo de lo que está EN VUELO ahora mismo. Va PRIMERO: si se limpiara
--    enviado_at antes, esas filas quedarían sin marca y la recuperación de trabados nunca
--    las devolvería a 'pendiente' (un filtro sobre NULL no las alcanza) — se quedarían
--    colgadas en 'enviando' para siempre.
update public.cola_mensajes
   set tomado_at = enviado_at
 where estado = 'enviando' and tomado_at is null and enviado_at is not null;

-- 2) Borrar la mentira: si no está 'enviado', no tiene fecha de envío.
update public.cola_mensajes
   set enviado_at = null
 where estado <> 'enviado' and enviado_at is not null;
