-- cron_km_sin_viaje_2026-07-25.sql   (Betangar — hrkjddehqnzcqwlkklqm)
--
-- Cron de la edge `km-sin-viaje`: MIÉRCOLES 11:00 UTC = 7:00 am de Venezuela.
--
-- ¿Por qué miércoles y no lunes? Porque las planillas se cargan VARIOS DÍAS DESPUÉS de la jornada
-- (regla de Máximo, 2026-07-25). Un reporte de lunes hablaría de una semana cuyas planillas todavía
-- no existen, y ya se vio a dónde lleva eso: el primer cruce dio 3.926 km "sin planilla" que en
-- realidad eran los días 22 al 25 sin cargar. Para el miércoles la semana anterior ya está adentro.
-- Y por si igual llegan tarde, la función mira 14 días hacia atrás y marca cada día UNA sola vez
-- (idempotente por `alertas_log.alert_key` = kmviaje_<cam>_<fecha>), así que un día cargado el
-- viernes se revisa igual el miércoles siguiente. Que carguen tarde deja de importar.
--
-- Sin secreto en el job (la función tiene verify_jwt=false y no recibe parámetros sensibles), que es
-- la norma del repo: el secreto nunca se escribe dentro del cron.
--
-- ⚠️ NOTA sobre `viajes-semanal`: ese cron corre los DOMINGOS sumando las planillas de la semana que
-- acaba de cerrar. Con el mismo razonamiento de arriba, ese reporte también sale incompleto — las
-- planillas de esa semana todavía no están cargadas. Queda anotado para revisarlo aparte.

select cron.schedule('km-sin-viaje-semanal', '0 11 * * 3', $job$
  select net.http_post(
    url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/km-sin-viaje',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
$job$);

-- Aplicado el 2026-07-25 (jobid 40, activo).
-- Para probarlo a mano sin mandar nada:
--   https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/km-sin-viaje?dry=1
--   …&desde=2026-07-01&hasta=2026-07-21   (fuerza una ventana)
