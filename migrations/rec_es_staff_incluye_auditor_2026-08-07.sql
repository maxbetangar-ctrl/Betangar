-- ════════════════════════════════════════════════════════════════════════════════════════════
-- MaxRecuerda — el rol `auditor` también es personal: puede leer y guardar recordatorios.
--
-- 2026-08-07. Alejandra (rol `auditor`) reportó que «Recordatorios no permite guardar».
-- No era la pantalla: `rec_es_staff()` listaba superadmin/admin/operador/rrhh y NO a `auditor`,
-- así que las políticas de `rec_recordatorios`, `rec_config` y `rec_destinos_extra` le negaban
-- SELECT, INSERT y UPDATE. El módulo se le mostraba y la base se lo rechazaba: la pantalla
-- ofrecía un permiso que no tenía. (`maxrecuerda.js` sí enseña el error, no falla en silencio —
-- por eso ella lo pudo reportar con esas palabras.)
--
-- Decisión de Máximo, 2026-08-07: «déjaselo activado a Alejandra, que ella pueda»,
-- «auditor o sea puede todo, solo que para borrar debo darle token».
--
-- ⚠️ Esto NO toca el borrado: DELETE sigue pasando por `rec_puede_borrar()` → `app_puede_borrar()`,
--    que hoy exige `superadmin`. Si `auditor` también debe poder borrar (con token), eso es un
--    cambio aparte y hay que decidirlo explícitamente — no se cuela acá.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.rec_es_staff()
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select public.app_rol() = any (array['superadmin','admin','operador','rrhh','auditor']);
$function$;

-- Comprobación: `auditor` tiene que dar true y un rol que no es del personal, false.
select
  'auditor'      = any (array['superadmin','admin','operador','rrhh','auditor']) as auditor_puede,
  'visualizador' = any (array['superadmin','admin','operador','rrhh','auditor']) as visualizador_no_puede,
  'vigilante'    = any (array['superadmin','admin','operador','rrhh','auditor']) as vigilante_no_puede;
