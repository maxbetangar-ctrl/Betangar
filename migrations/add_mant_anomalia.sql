-- ════════════════════════════════════════════════════════════════════════════
-- ANTI-FRAUDE mantenimiento: marcar servicios ADELANTADOS (hechos antes de su vida útil).
-- Al registrar un servicio que repite un ítem hecho hace MENOS de su intervalo esperado, la app
-- pide un MOTIVO obligatorio (bloquea hasta escribirlo) y lo graba como anomalía → tablero para
-- cazar cambios de piezas antes de tiempo (fraude del taller). Columnas nuevas en mantenimientos.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.mantenimientos add column if not exists anomalia boolean default false;
alter table public.mantenimientos add column if not exists motivo text;
-- (RLS de mantenimientos ya existe; no se toca.)
