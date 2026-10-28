-- ════════════════════════════════════════════════════════════════════════════════════════════
-- EL RESUMEN A LOS SOCIOS SALE SOLO, LOS LUNES — Betangar · 28/10/2026
--
-- Lunes 13:00 UTC = 9:00 de la mañana en Venezuela. El lunes a propósito: la Alcaldía paga
-- cualquier día (02/10, 07/10, 13/10, 15/10, 22/10 — nunca el mismo), así que un día fijo de
-- envío no sirve para MARCAR el período, pero sí para entregarlo. El período lo pone
-- `btg_ciclo_alcaldia()`; el lunes solo decide cuándo se lee.
--
-- ⛔ EL SECRETO NO SE ESCRIBE ACÁ. Se copia del cron que YA lo tiene (`auditoria-interna-mensual`)
--    dentro de la misma transacción. Así este archivo puede vivir en el repo sin llevar la
--    credencial, y el día que el secreto rote no queda una copia vieja pudriéndose en un .sql.
--    [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ⛔ SI SALE FUERA DE LA FRANJA 8-20 DE VENEZUELA, la función no manda Y NO REGISTRA la corrida:
--    el informe queda para la vuelta siguiente en vez de darse por entregado sin haber salido.
-- ════════════════════════════════════════════════════════════════════════════════════════════

do $mig$
declare
  v_secreto text;
  v_apikey  text;
  v_cmd     text;
begin
  -- De dónde salen las dos credenciales: del cron que ya corre. Si no están, se planta — un cron
  -- creado sin llave respondería 401 todos los lunes y desde afuera se vería igual que «no anda».
  select (regexp_match(command, '''x-api-key'',''([0-9a-f]+)'''))[1],
         (regexp_match(command, '''apikey'',''([A-Za-z0-9._-]+)'''))[1]
    into v_secreto, v_apikey
    from cron.job where jobname = 'auditoria-interna-mensual';

  if v_secreto is null or v_apikey is null then
    raise exception 'No se pudieron leer las credenciales del cron auditoria-interna-mensual; no se crea el trabajo a ciegas';
  end if;

  v_cmd := format($c$
    select net.http_post(
      url := 'https://hrkjddehqnzcqwlkklqm.supabase.co/functions/v1/resumen-socios',
      headers := jsonb_build_object('x-api-key', %L, 'Content-Type', 'application/json', 'apikey', %L),
      body := '{}'::jsonb
    ) as request_id;
  $c$, v_secreto, v_apikey);

  perform cron.unschedule('resumen-socios-semanal')
    where exists (select 1 from cron.job where jobname = 'resumen-socios-semanal');
  perform cron.schedule('resumen-socios-semanal', '0 13 * * 1', v_cmd);
end
$mig$;
