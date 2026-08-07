-- ═══════════════════════════════════════════════════════════════════════════════
-- empleados.fegreso — la fecha en que la persona DEJÓ la empresa
-- 2026-08-07
-- ═══════════════════════════════════════════════════════════════════════════════
-- Hasta hoy la baja se guardaba solo como `activo=false`: quedaba QUE se fue, pero
-- no CUÁNDO. Sin fecha no se puede cotejar una nómina contra el padrón ni armar el
-- expediente de la persona.
--
-- ⚠️ `created_at` NO sirve para esto y `fingreso` tampoco es su gemelo automático:
--    en la ficha E002, created_at = 2026-05-23 (cuándo se cargó al sistema) y
--    fingreso = 2026-03-03 (cuándo entró de verdad). Son cosas distintas.
--
-- NULL = sigue en la empresa. Es estructura, así que va en las 3 bases del grupo:
-- Betangar (hrkjddehqnzcqwlkklqm), Flotilla (mcvizzknpqrggohbohcw) y
-- flotamax-demo (mogntbltkkdtyojrchvh). flotamax-demo-nuevo ya no existe.
--
-- Sin CHECK contra fingreso a propósito: un catálogo no puede trancar el registro.
-- Si una ficha vieja trae fechas raras, el sistema tiene que poder guardarla igual.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.empleados add column if not exists fegreso date;

comment on column public.empleados.fegreso is
  'Fecha en que dejó la empresa. NULL = sigue activa. No confundir con created_at (cuándo se cargó la ficha) ni con fingreso (cuándo entró).';
