-- ════════════════════════════════════════════════════════════════════════════
--  MAÑANA, CON EL DÍA CERRADO, SALEN LAS HOJAS DEL SÁBADO 31/10.
--
--  PEDIDO (Máximo, 31/10/2026): «mañana cuando cierre el día mandas los de hoy».
--
--  POR QUÉ NO SE MANDARON HOY: a las 17:55 seis camiones seguían recogiendo, y se
--  vio en vivo una calle de B009 pasar de «pendiente» a «cubierta» entre dos
--  consultas. Un día en curso no se audita: la hoja reclamaría calles que se
--  limpian una hora después. [[norma-una-medicion-tiene-hora]]
--
--  ⛔ VA EN LA BASE, NO EN UNA SESIÓN. Un recordatorio que depende de que alguien
--     esté con la computadora abierta no es un recordatorio.
--
--  ⛔ SE DISPARA VARIAS VECES A PROPÓSITO (cada 20 min, de 8:00 a 11:40 de
--     Venezuela). `net.http_post` no espera respuesta: si el primer intento falla
--     —la función caída, la base ocupada— nadie se entera. Repetir es gratis
--     porque `ruta-chofer` ya tiene candado por `alertas_log`, con clave
--     `ruta-chofer-<camion>-<dia>`: el segundo intento no reenvía, contesta «ya se
--     le mando». Comprobado: las 4 marcas del 30/10 están puestas.
--
--  ⛔ Y SE BORRA SOLO. El 2/11, la primera corrida ve que ya no es el día y se
--     des-programa. Un cron de una sola vez que queda vivo para siempre vuelve a
--     disparar dentro de un año, cuando nadie se acuerde de por qué existe.
--
--  📌 EL SECRETO NO SE ESCRIBE ACÁ: se lee del cron que ya lo tiene. Así este
--     archivo puede vivir en el repo —que es PÚBLICO— y el día que la llave rote
--     no queda una copia vieja pudriéndose. [[norma-secreto-nunca-en-el-codigo]]
--
--  ⚠️ Las horas de `cron.job` son UTC. Venezuela es UTC-4: 12:00 UTC = 8:00 VE.
--     La franja de envío de la pieza es 8 a 20 VE, así que esto cae adentro.
-- ════════════════════════════════════════════════════════════════════════════

do $mig$
declare
  v_key  text;
  v_anon text;
  v_cmd  text;
  v_job  text := 'ruta-chofer-del-sabado-31';
begin
  -- La llave de la función y la anon, de un cron que ya las tiene.
  select (regexp_match(command, '''x-api-key'',''([0-9a-f]+)'''))[1],
         (regexp_match(command, '''apikey'',''(ey[A-Za-z0-9._-]+)'''))[1]
    into v_key, v_anon
    from cron.job where jobname = 'auditoria-interna-mensual';

  if v_key is null or v_anon is null then
    raise exception 'no se pudo leer la llave del cron existente: no se programa nada a medias';
  end if;

  v_cmd := format($q$
do $inner$
begin
  if (now() at time zone 'America/Caracas')::date = date '2026-11-01' then
    perform net.http_post(
      url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/ruta-chofer?dia=2026-10-31',
      headers := jsonb_build_object(
        'x-api-key', %L, 'Content-Type', 'application/json',
        'apikey', %L, 'Authorization', 'Bearer ' || %L),
      body := '{}'::jsonb);
  else
    perform cron.unschedule(%L);
  end if;
end $inner$;
$q$, v_key, v_anon, v_anon, v_job);

  -- Si ya existía (una corrida anterior de este archivo), se reemplaza.
  perform cron.unschedule(v_job) where exists (select 1 from cron.job where jobname = v_job);

  perform cron.schedule(v_job, '*/20 12-15 * * *', v_cmd);
end $mig$;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $v$
declare v_n int; v_sched text; v_cmd text;
begin
  select count(*), max(schedule), max(command) into v_n, v_sched, v_cmd
    from cron.job where jobname = 'ruta-chofer-del-sabado-31';
  if v_n <> 1 then
    raise exception 'el cron no quedo programado (n=%)', v_n;
  end if;
  -- ⛔ Que el día pedido sea el SÁBADO, no «hoy». Si la URL se quedara sin `dia`,
  --    la función mandaría las hojas del día en que corra —el domingo, vacío— y
  --    las del sábado no saldrían nunca.
  if position('dia=2026-10-31' in v_cmd) = 0 then
    raise exception 'la URL del cron no pide el dia 2026-10-31';
  end if;
  if position('cron.unschedule' in v_cmd) = 0 then
    raise exception 'el cron no se borra solo: quedaria disparando para siempre';
  end if;
  -- Y que la llave de verdad haya entrado (no el texto 'null').
  if position('x-api-key'', ''null' in v_cmd) > 0 then
    raise exception 'la llave quedo en null';
  end if;
  raise notice 'OK · % programado (% UTC), pide dia=2026-10-31 y se borra solo',
    'ruta-chofer-del-sabado-31', v_sched;
end $v$;
