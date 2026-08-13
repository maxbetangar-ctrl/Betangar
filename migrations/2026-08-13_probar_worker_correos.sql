-- Llama al worker de correos UNA vez y devuelve el id de la petición, para poder
-- leer SU respuesta y no confundirla con la de otro cron (el worker de WhatsApp
-- devuelve exactamente la misma forma: {ok, sent, caducados}).
-- La clave anon no se escribe: se saca del cron que ya existe.
select net.http_post(
  url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/procesar_cola_correos',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', k,
    'Authorization', 'Bearer ' || k
  ),
  body := '{}'::jsonb
) as request_id
from (
  select (regexp_match(command, '''apikey'',''([^'']+)'''))[1] as k
  from cron.job where jobname = 'betangar-wassenger-worker'
) s;
