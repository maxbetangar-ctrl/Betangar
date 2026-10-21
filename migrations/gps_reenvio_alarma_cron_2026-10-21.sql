-- ════════════════════════════════════════════════════════════════════════════
--  La alarma del reenvío a la Alcaldía: sus dos tareas.
--  Escrito el 21/10/2026, a pedido de Máximo («HAZ LA ALARMA DE SILENCIO»).
--
--  ⛔ POR QUÉ SON DOS Y NO UNA, con cadencias distintas:
--
--   · `gps-reenvio-vigila` (cada 10 min) MIRA y habla SOLO cuando se rompe algo.
--     Se calla sola mientras el reenvío está apagado a propósito: avisar de algo
--     que alguien apagó es el aviso que salta siempre, y un aviso que salta
--     siempre no avisa de nada.
--
--   · `gps-reenvio-parte` (una vez al día) SALE SIEMPRE, aunque todo esté bien.
--     Es la norma de la casa: un informe que solo sale cuando hay novedad no
--     distingue «no hubo novedad» de «el que avisa está muerto».
--     ⚠️ Y es el ÚNICO que delata el interruptor apagado. La vigilancia se
--     calla; el parte lo dice todos los días, con la fecha. Se apaga a mano;
--     que siga apagado no se olvida solo.
--
--  ⛔ ATARLAS SERÍA EL ERROR. Mirar seguido y avisar seguido son cosas
--  distintas: la vigilancia mira cada 10 minutos pero no repite un aviso
--  mientras el reenvío siga parado en el mismo instante. Un reenvío que se cae
--  un viernes avisa UNA vez, no 288 veces hasta el lunes.
--
--  La clave NO se escribe acá: se copia de la tarea del sondeo, que ya la
--  tiene. Este archivo entra a un repo público. [[norma-secreto-nunca-en-el-codigo]]
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare k text; base text;
begin
  select (regexp_match(command, '''x-api-key'',''([^'']+)'''))[1] into k
    from cron.job where jobname = 'gps-sondeo-betangar';
  if k is null or length(k) < 10 then
    raise exception 'No se pudo copiar la clave de `gps-sondeo-betangar`. Sin clave, '
      'la función contesta 401 y la alarma queda muda sin que nadie lo note.';
  end if;

  base := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/gps-vigilante?modo=reenvio';

  -- Cada 10 minutos: ¿sigue saliendo?
  perform cron.schedule(
    'gps-reenvio-vigila-betangar',
    '*/10 * * * *',
    format($f$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-api-key',%L),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000);$f$, base, k)
  );

  -- 12:50 UTC = 08:50 en Venezuela. Después del parte de servicio técnico
  -- (09:10) no: antes, para que lo primero del día sea si el recorrido salió.
  perform cron.schedule(
    'gps-reenvio-parte-betangar',
    '50 12 * * *',
    format($f$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-api-key',%L),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000);$f$, base || '&parte=1', k)
  );
end $$;

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
-- ⛔ «Quedó programado» es una impresión. Y acá el modo de fallar es callado: una
-- tarea sin clave contesta 401, no avisa nunca, y el silencio se lee como «no
-- hubo problemas». Hay que comprobar las tres cosas: que existan, que estén
-- activas y que lleven la clave.
do $$
declare n int; sin_clave int; inactivas int;
begin
  select count(*) into n from cron.job
   where jobname in ('gps-reenvio-vigila-betangar', 'gps-reenvio-parte-betangar');
  if n <> 2 then raise exception 'CONTROL: se esperaban 2 tareas y hay %', n; end if;

  select count(*) into inactivas from cron.job
   where jobname in ('gps-reenvio-vigila-betangar', 'gps-reenvio-parte-betangar')
     and not active;
  if inactivas > 0 then raise exception 'CONTROL: % tarea(s) quedaron inactivas', inactivas; end if;

  select count(*) into sin_clave from cron.job
   where jobname in ('gps-reenvio-vigila-betangar', 'gps-reenvio-parte-betangar')
     and (regexp_match(command, '''x-api-key'',''([^'']{10,})'''))[1] is null;
  if sin_clave > 0 then
    raise exception 'CONTROL: % tarea(s) sin clave: contestarían 401 y la alarma '
      'quedaría muda sin avisar', sin_clave;
  end if;

  -- Y que una pida el parte y la otra no: si las dos pidieran lo mismo, habría
  -- dos vigilancias y ningún parte, que es justo el agujero que vino a tapar.
  if (select count(*) from cron.job
       where jobname = 'gps-reenvio-parte-betangar' and command like '%parte=1%') <> 1
  then raise exception 'CONTROL: la tarea del parte no pide el parte'; end if;
  if (select count(*) from cron.job
       where jobname = 'gps-reenvio-vigila-betangar' and command like '%parte=1%') <> 0
  then raise exception 'CONTROL: la vigilancia pide el parte y no debe'; end if;

  raise notice 'OK · 2 tareas activas, con clave, y cada una pide lo suyo';
end $$;
