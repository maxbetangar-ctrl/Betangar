-- ════════════════════════════════════════════════════════════════════════════
--  La tarea del reenviador: CADA MINUTO.
--  Pedido por Máximo el 21/10/2026: «programalo cada minuto».
--
--  POR QUÉ CADA MINUTO, y está medido: con el motor encendido el equipo nos
--  entrega **1 posición por minuto** (mediana sobre 11.874 intervalos), y una
--  posición entra a nuestra base con **17 segundos** de antigüedad (mediana).
--  Mandando cada minuto, la pantalla de la Alcaldía queda a la par de la
--  nuestra. Más seguido no gana nada: no hay más datos que mandar.
--
--  ⚠️ SE PROGRAMA ESTANDO APAGADO, Y ESO ES SEGURO A PROPÓSITO.
--  `gps-reenvio` lee `configuracion.gps_reenvio_activo` y, en `false`, contesta
--  y se va SIN tocar nada: ni manda, ni mueve el cursor, ni escribe la hora de
--  la corrida. O sea que la tarea puede correr desde hoy sin que salga una sola
--  posición. Encender es una línea (`gps_reenvio_activo = true`) y no hace falta
--  volver a tocar el cron ni redesplegar nada.
--  ⛔ Y la alarma tampoco grita por esto: su vigilancia se calla mientras el
--  reenvío esté apagado. Que siga apagado lo dice el parte diario.
--
--  ⚠️ LO QUE HAY QUE MIRAR EL DÍA QUE SE ENCIENDA: el cursor arrancó en el
--  momento de instalar (21/10 ~13:50 UTC) y, mientras esté apagado, el atraso
--  CRECE ~10 posiciones por minuto. Si se enciende una semana después, la
--  primera corrida le tira a un servidor ajeno un montón de peticiones de
--  golpe, y eso desde afuera se ve como un ataque. Al encender hay que decidir
--  una de dos: mover el cursor a `now()` y arrancar desde ese momento, o
--  avisarle a Leonel que va a entrar el acumulado. No se decide hoy.
--
--  La clave no se escribe acá: se copia de la tarea del sondeo, que ya la
--  tiene. Este archivo entra a un repo público.
--  [[norma-secreto-nunca-en-el-codigo]]
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare k text;
begin
  select (regexp_match(command, '''x-api-key'',''([^'']+)'''))[1] into k
    from cron.job where jobname = 'gps-sondeo-betangar';
  if k is null or length(k) < 10 then
    raise exception 'No se pudo copiar la clave de `gps-sondeo-betangar`. Sin clave la '
      'función contesta 401 y el reenvío quedaría muerto sin que nadie lo note.';
  end if;

  perform cron.schedule(
    'gps-reenvio-betangar',
    '* * * * *',
    format($f$select net.http_post(
        url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/gps-reenvio',
        headers := jsonb_build_object('Content-Type','application/json','x-api-key',%L),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000);$f$, k)
  );
end $$;

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
-- ⛔ «Quedó programada» es una impresión, y acá el modo de fallar es callado:
-- una tarea sin clave contesta 401 para siempre y el silencio se lee como
-- «no había nada que mandar».
do $$
declare n int;
begin
  select count(*) into n from cron.job
   where jobname = 'gps-reenvio-betangar'
     and schedule = '* * * * *'
     and active
     and (regexp_match(command, '''x-api-key'',''([^'']{10,})'''))[1] is not null
     and command like '%/gps-reenvio%';
  if n <> 1 then
    raise exception 'CONTROL: la tarea del reenvío no quedó como se pidió (coincidencias: %)', n;
  end if;

  -- Y el interruptor TIENE que seguir apagado: programar no es encender.
  if (select lower(valor) from configuracion where clave = 'gps_reenvio_activo') <> 'false' then
    raise exception 'CONTROL: programar la tarea dejó el reenvío ENCENDIDO. Nadie pidió eso.';
  end if;

  raise notice 'OK · tarea cada minuto, activa, con clave · el reenvío sigue APAGADO';
end $$;
