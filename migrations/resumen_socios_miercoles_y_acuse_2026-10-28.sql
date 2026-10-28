-- ════════════════════════════════════════════════════════════════════════════════════════════
-- EL RESUMEN PASA AL MIÉRCOLES, Y MÁXIMO SABE A QUIÉN LE LLEGÓ — Betangar · 28/10/2026
--
-- 🔬 EL DÍA. Máximo: «envíalo los miércoles que ya se ha pagado nómina y eso», «no lo envíes los
--    lunes». Medido contra el banco (agosto–octubre 2026), tiene razón y por más margen del que
--    parece: la nómina cae **MARTES** —569 movimientos, Bs 44.467.231— y el resto el miércoles
--    —129 movimientos, Bs 11.494.677—. El lunes cortaba el ciclo justo ANTES del gasto más
--    grande de la semana, así que el informe mostraba la entrada de la Alcaldía sin la nómina
--    que esa entrada paga. El miércoles la agarra entera.
--
-- 🔬 EL ACUSE. Máximo: «también me lo envías a mí para saber que sí les llegó a ellos». Él YA es
--    destinatario (rol `socios`), así que la copia no es lo que falta: lo que falta es saber si
--    salió para los demás. Por eso se guarda con qué filas de la cola salió cada corrida, y una
--    segunda pasada —45 minutos después— le dice a quién le salió y a quién no.
--
-- ⛔ Y VA A DECIR LA VERDAD, QUE ES INCÓMODA: que el proveedor acepte un mensaje NO prueba que
--    llegó al teléfono. Desde el 29/09/2026 no hay acuses de entrega, así que `processed` se ve
--    igual que `entregado`. El aviso dice lo que el sistema SABE —salió / no salió / se frenó y
--    por qué— y nunca afirma «le llegó». [[norma-el-destino-de-un-mensaje-es-el-wid]]
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Con qué filas de la cola salió cada corrida ──────────────────────────────────────────
alter table public.btg_resumen_socios_corridas
  add column if not exists cola_ids   bigint[],
  add column if not exists acuse_at   timestamptz;

comment on column public.btg_resumen_socios_corridas.cola_ids is
  'Las filas de `cola_mensajes` con las que salió esta corrida, una por destinatario. Es lo que permite decir DESPUÉS a quién le salió y a quién no: sin esto habría que adivinar cruzando por fecha y teléfono.';
comment on column public.btg_resumen_socios_corridas.acuse_at is
  'Cuándo se le avisó a Máximo cómo salió esta corrida. Mientras esté en NULL, el acuse está pendiente — es lo que impide avisar dos veces y, sobre todo, lo que impide que una corrida se quede sin avisar en silencio.';

-- ── 2. Cuándo sale, leído del cron y no escrito a mano ──────────────────────────────────────
-- ⛔ LA PANTALLA DECÍA «sale los lunes» EN TEXTO FIJO. Eso es una segunda lista: el día que se
--    cambie el cron —como hoy— la pantalla sigue afirmando el día viejo, y nadie se entera
--    porque sigue sin dar error. [[norma-dos-listas-a-mano-se-desincronizan]] Acá el día sale
--    del trabajo programado DE VERDAD, así que no puede mentir.
create or replace function public.btg_resumen_socios_cuando()
returns text language plpgsql stable security definer set search_path = public, cron as $fn$
declare v_sched text; v_dow text; v_hh int; v_min int; v_activo boolean;
begin
  select schedule, active into v_sched, v_activo from cron.job where jobname = 'resumen-socios-semanal';
  if v_sched is null then return 'no está programado'; end if;
  if not v_activo then return 'está programado pero APAGADO'; end if;
  -- '0 13 * * 3'  ->  minuto hora * * díaDeSemana ; la hora del cron es UTC y el negocio es VE (UTC-4)
  v_min := split_part(v_sched,' ',1)::int;
  v_hh  := (split_part(v_sched,' ',2)::int + 24 - 4) % 24;
  v_dow := case split_part(v_sched,' ',5)
             when '0' then 'domingos' when '1' then 'lunes'   when '2' then 'martes'
             when '3' then 'miércoles' when '4' then 'jueves' when '5' then 'viernes'
             when '6' then 'sábados'  else 'día ' || split_part(v_sched,' ',5) end;
  return format('%s a las %s:%s', v_dow, lpad(v_hh::text,2,'0'), lpad(v_min::text,2,'0'));
end $fn$;
comment on function public.btg_resumen_socios_cuando() is
  'Cuándo sale el resumen a los socios, en castellano y en hora de Venezuela, LEÍDO del trabajo programado de verdad. ⛔ No es un texto fijo: si alguien cambia el cron, esto cambia solo. Dice también si quedó apagado o si no existe, en vez de callarse.';

revoke execute on function public.btg_resumen_socios_cuando() from public, anon;
grant  execute on function public.btg_resumen_socios_cuando() to authenticated, service_role;

-- ── 3. El día nuevo: MIÉRCOLES ──────────────────────────────────────────────────────────────
-- 13:00 UTC = 9:00 de la mañana en Venezuela. Se reusa el comando que ya tiene el trabajo para
-- no volver a tocar las credenciales: solo cambia el día.
do $mig$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'resumen-socios-semanal';
  if v_cmd is null then
    raise exception 'No existe el trabajo resumen-socios-semanal; no se reprograma a ciegas';
  end if;
  perform cron.unschedule('resumen-socios-semanal');
  perform cron.schedule('resumen-socios-semanal', '0 13 * * 3', v_cmd);

  -- El acuse: 45 minutos después, el tiempo que le sobra al worker de la cola (corre cada 3 min)
  -- para haber intentado las cuatro filas y haber dejado escrito qué pasó con cada una.
  perform cron.unschedule('resumen-socios-acuse')
    where exists (select 1 from cron.job where jobname = 'resumen-socios-acuse');
  perform cron.schedule('resumen-socios-acuse', '45 13 * * 3', replace(v_cmd, '/resumen-socios', '/resumen-socios?acuse=1'));
end
$mig$;
