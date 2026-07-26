-- ════════════════════════════════════════════════════════════════════════════
-- AGREGAR `unidad_config.modo` (cómo trabaja la unidad: ruta / viaje)
--
-- MISMO HUECO QUE `surtidas`: esta columna se agregó en su día por MCP y nunca
-- quedó archivo en el repo. `flotilla_surtidas_gasolina_estaciones_2026-07-24.sql`
-- la LEE (redefine `unidad_publica` con `coalesce(modo,'ruta')`) pero nadie la
-- crea → en una base nueva esa migración revienta con
-- `column "modo" does not exist`. Se detectó al poner el demo al día.
--
-- Definición tomada de la base VIVA de Flotilla (mcvizzknpqrggohbohcw) el
-- 2026-07-26: `text` con default 'ruta'.
--
-- ⚠️ ORDEN: correr ANTES de `flotilla_surtidas_gasolina_estaciones_2026-07-24.sql`.
--
-- Aditiva (`if not exists`): en una base que ya la tiene, no hace nada.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.unidad_config add column if not exists modo text default 'ruta';

-- El default solo aplica a filas nuevas; las que ya estaban quedan en NULL y el
-- `coalesce(modo,'ruta')` de unidad_publica las cubre. Igual se rellenan para que
-- la columna diga la verdad por sí sola y no dependa del coalesce.
update public.unidad_config set modo = 'ruta' where modo is null;
