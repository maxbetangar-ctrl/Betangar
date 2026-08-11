-- ════════════════════════════════════════════════════════════════════════════════════════════
-- RECORDATORIO SEMANAL A LA AUDITORA — lunes 9:00 am VE
-- Máximo, 2026-08-11: «programa un mensaje para ella automático todos los lunes de cada semana».
--
-- 13:00 UTC = 9:00 am en Venezuela. A las 7 y a las 8 ya salen `km-semanal` y `supervisor-nomina`,
-- que son internos; este es para alguien de afuera y a las 9 la administración ya puede contestarle.
--
-- ⛔ POR QUÉ LLEVA CABECERA `Authorization` Y OTROS CRONS NO. Las funciones que el cron llama sin
-- cabecera están desplegadas con `--no-verify-jwt` (km-semanal, km-sin-viaje, calendario-fiscal…).
-- Esta NO: se dejó privada. La primera versión de este cron se copió del de `km-semanal` y la
-- llamada devolvió **401 UNAUTHORIZED_NO_AUTH_HEADER** — o sea que el lunes no habría salido nada
-- y **nadie se habría enterado**, porque un cron que falla no se queja.
-- [[norma-mirar-la-ultima-corrida-no-la-existencia]]
--
-- Va la clave PÚBLICA (anon), no la de servicio: ya está publicada en betangar.com/app.js, así que
-- no es un secreto viviendo dentro de `cron.job` [[norma-secreto-no-vive-donde-se-escribe-historial]].
--
-- El teléfono NO va acá ni en la función: se declara en `configuracion.auditor_tel`, y si faltara,
-- la función lo busca por el cargo en `empleados` [[norma-fuente-unica-datos]].
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _cr_log(paso text, detalle text) on commit preserve rows;
truncate _cr_log;

-- ── 1) La destinataria, declarada ────────────────────────────────────────────────────────────
insert into public.configuracion (clave, valor)
values ('auditor_tel', '04141641630')
on conflict (clave) do update set valor = excluded.valor;
insert into _cr_log values ('1. destinataria', 'configuracion.auditor_tel = ' ||
  (select valor from public.configuracion where clave='auditor_tel'));

-- ── 2) El cron ───────────────────────────────────────────────────────────────────────────────
select cron.unschedule('auditora-semanal-lunes')
 where exists (select 1 from cron.job where jobname='auditora-semanal-lunes');

select cron.schedule('auditora-semanal-lunes', '0 13 * * 1', $job$
  select net.http_post(
    url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/auditora-semanal',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhya2pkZGVocW56Y3F3bGtrbHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTk1NzIsImV4cCI6MjA5MzIzNTU3Mn0.kqWKthyZfPZ86toql7shGByF-ZhUpcQUS4Jw4RnG_ko"}'::jsonb
  ) as request_id;
$job$);

insert into _cr_log
select '2. cron', jobname || ' · ' || schedule || ' · activo=' || active::text
  from cron.job where jobname='auditora-semanal-lunes';

-- ── 3) Control ───────────────────────────────────────────────────────────────────────────────
insert into _cr_log
select '3. control', 'trabajos con ese nombre (debe ser 1): ' || count(*)::text
  from cron.job where jobname='auditora-semanal-lunes';
insert into _cr_log
select '3. control', 'lleva Authorization: ' ||
  case when command ilike '%authorization%' then 'sí' else '⚠️ NO' end
  from cron.job where jobname='auditora-semanal-lunes';

select * from _cr_log;
