-- ============================================================================
-- MaxRecuerda — EL LATIDO
--
-- Sin esto, el módulo es un cuaderno bonito: guarda las promesas y no avisa
-- ninguna. Es la pieza que más fácil se olvida al clonar, así que
-- `rec_diagnostico()` la comprueba explícitamente.
--
-- ⛔ POR QUÉ pg_cron Y NO UN CRON DE VERCEL:
--    · el plan Hobby solo permite UNA corrida al día — un recordatorio de las
--      3 de la tarde saldría al día siguiente, o sea nunca;
--    · el secreto queda FUERA de la definición del job;
--    · y no depende de que una PC esté encendida, que es lo que tumbaba los
--      syncs antes de subirlos a la nube.
--
-- Cada minuto. La consulta va por índice parcial sobre los pendientes: en una
-- base con miles de recordatorios sigue leyendo decenas de filas.
-- ============================================================================

create extension if not exists pg_cron;

-- Reprogramar es seguro: se borra el viejo y se pone el nuevo. Sin el unschedule
-- previo quedan DOS jobs y todo se dispara dos veces.
do $$
begin
  perform cron.unschedule('maxrecuerda-latido');
exception when others then null;
end $$;

select cron.schedule('maxrecuerda-latido', '* * * * *', $$select public.rec_tick();$$);

-- ── Comprobación ────────────────────────────────────────────────────────────
-- select jobid, jobname, schedule, active from cron.job where jobname = 'maxrecuerda-latido';
--
-- Y a los dos minutos, la prueba de que LATIÓ (no de que existe — no es lo
-- mismo, y confundirlas es cómo se dan por buenas tres corridas que no
-- entregaron nada):
-- select status, return_message, start_time
--   from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'maxrecuerda-latido')
--  order by start_time desc limit 5;

-- ── El vigilante ────────────────────────────────────────────────────────────
-- Un latido caído se ve exactamente igual que «no había nada que avisar».
-- Esta consulta es la que distingue las dos cosas, y es la que tiene que mirar
-- la auditoría mensual del cliente:
--
--   select count(*) as se_pasaron_de_hora
--     from public.rec_disparos
--    where estado = 'vencido' and procesado_at > now() - interval '7 days';
--
-- Si eso no es 0, hubo promesas que el sistema no cumplió. Y eso se REPORTA,
-- no se limpia.
