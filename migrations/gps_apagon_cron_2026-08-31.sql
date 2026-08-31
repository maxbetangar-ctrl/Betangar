-- ════════════════════════════════════════════════════════════════════════════
--  Cron del apagón de flota — 31/08/2026
--
--  ⚠️ CADA 5 MINUTOS, y no dos veces al día como el resto de `gps-vigilante`.
--  El apagón del 31/08 duró 65 minutos. Un chequeo a las 10:40 y otro a las 17:40
--  lo habría contado como historia, no como algo que está pasando — y al proveedor
--  se le avisa para que lo destrabe AHORA, no para contarle lo de la mañana.
--
--  Cada corrida es una consulta a `gps_mudas_andando` sobre diez filas. Barato.
--
--  ⛔ Que corra cada 5 minutos NO significa que avise cada 5 minutos: la espera de
--  60 min por episodio vive dentro de la función. Separar las dos cosas es a
--  propósito — la cadencia de MIRAR y la de AVISAR no tienen por qué coincidir, y
--  atarlas es como se fabrica un aviso que salta siempre.
select cron.schedule(
  'gps-apagon-betangar',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/gps-vigilante?modo=apagon',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
