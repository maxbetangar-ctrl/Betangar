-- ════════════════════════════════════════════════════════════════════════════
-- FIX C1 (auditoría 2026-07-04) — pagos_alcaldia nunca persistió (tabla vacía).
-- Causa: la columna `id` era bigint GENERATED ALWAYS AS IDENTITY (la base genera el id y
-- PROHÍBE suministrarlo), pero la app genera y usa ids de TEXTO ('ALC'+timestamp) como clave
-- (onConflict:'id', lookups del botón Dev.Fiel, dedup). Todo insert con id de texto fallaba
-- (428C9), así que el desglose de retenciones, el FIEL CUMPLIMIENTO (10% por cobrar) y el 7.5%
-- se perdían al recargar (solo sobrevivía el abono neto en la tabla `abonos`).
--
-- La tabla está VACÍA → cambio seguro. Alinea la columna al modelo del código (id de texto).
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm) ANTES de confiar en el
-- guardado de pagos de la Alcaldía. Reversible: no aplica (no había datos).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.pagos_alcaldia alter column id drop identity if exists;
alter table public.pagos_alcaldia alter column id type text using id::text;

-- Verificación (debe devolver data_type = 'text' e is_identity = 'NO'):
--   select column_name, data_type, is_identity from information_schema.columns
--   where table_schema='public' and table_name='pagos_alcaldia' and column_name='id';
