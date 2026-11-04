-- ═══════════════════════════════════════════════════════════════════════════════
-- LA SEMANA ES LUNES A DOMINGO — 2026-11-04
--
-- Máximo: «la incoherencia de lunes a sábado y lunes a domingo debes arreglarlo,
-- todo debe ser de lunes a domingo».
--
-- 🔴 NO ERA UNA INCOHERENCIA DE FORMATO. El cierre semanal que va a la Alcaldía
--    cortaba en SÁBADO, asi que **los viajes del domingo no entraban en ninguna
--    semana**. Medido en la semana del 26/10/2026:
--
--      relacion que ve el IMAU (lunes a domingo) ... 193 viajes · US$ 50.411,60
--      cierre semanal automatico (lunes a sabado) ... 174 viajes · US$ 45.448,80
--      diferencia ................................... 19 viajes
--
--    y 19 es EXACTAMENTE la columna del domingo 01/11 en la pantalla de cobranza.
--    No era un desfase de presentacion: se le informaba de menos a la Alcaldia, y
--    los domingos se caian del mundo.
--
-- ⚠️ POR ESO EL CRON SE MUEVE AL LUNES. Una semana que termina el domingo no se
--    puede cerrar el domingo a las 9 de la mañana: faltaria el propio domingo.
--    `viajes-semanal-domingo` pasa de `0 13 * * 0` a `0 13 * * 1` (lunes 9:00 VE).
--    El nombre del job se conserva para no perder su historial; lo que manda es el
--    `schedule`, y queda dicho aca por que ya no corre el dia que dice su nombre.
--
-- 📌 Lo que YA estaba bien y no se toca: la nomina calcula lunes+6 = domingo en sus
--    seis sitios, y `auditora-semanal` tambien. `km-semanal` cerraba en sabado y se
--    corrige en su codigo (ya corria los lunes).
-- ═══════════════════════════════════════════════════════════════════════════════

select cron.alter_job(
  job_id   => (select jobid from cron.job where jobname = 'viajes-semanal-domingo'),
  schedule => '0 13 * * 1'
);

-- ── Comprobacion ───────────────────────────────────────────────────────────────
select jobname, schedule, active,
       case schedule when '0 13 * * 1' then 'lunes 9:00 VE' else '⛔ revisar' end cuando
  from cron.job
 where jobname in ('viajes-semanal-domingo','km-semanal-lunes','auditora-semanal-lunes')
 order by jobname;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   select cron.alter_job(
--     job_id => (select jobid from cron.job where jobname='viajes-semanal-domingo'),
--     schedule => '0 13 * * 0');
-- ═══════════════════════════════════════════════════════════════════════════════
