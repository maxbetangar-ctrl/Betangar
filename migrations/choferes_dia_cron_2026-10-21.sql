-- ============================================================================
-- CHOFERES POR UNIDAD, TODOS LOS DÍAS A LAS 8:00, AL IMAU — 2026-10-21.
--
-- Máximo: «ponlo a las 8 am con ese formato».
--
-- ⛔ CORRE EN LA NUBE. «Es importante que ese reporte salga con mi computadora
--    prendida o sin prenderla». El primero salió a mano desde su máquina; de acá
--    en adelante lo dispara `pg_cron` contra la función `choferes-dia`, así que
--    su PC no está en la cadena.
--
-- 12:00 UTC = 8:00 de Venezuela. TODOS los días, también domingo: un reporte que
-- se calla el domingo se ve igual que un reporte caído, y la función ya sabe
-- decir «todavía no hay ninguna unidad confirmada».
-- ============================================================================

-- ── 1 · EL DESTINATARIO, DECLARADO UNA SOLA VEZ ────────────────────────────
-- ⛔ No va en el código: el IMAU va a querer sumar gente y eso no puede pedir un
--    despliegue. Y sobre todo: un número que se reteclea en cada envío se vuelve
--    a equivocar. El 21/10 se tecleó `…605 77 64` en vez de `…605 87 64` y el
--    reporte —nombres y teléfonos de los 12 choferes— se entregó a un
--    desconocido, sin poder revocarlo. Acá queda escrito UNA vez, ya verificado
--    contra el chat («DORIAN IZARRA IMAU»).
--    [[norma-el-destino-de-un-mensaje-es-el-wid]] [[dorian-izarra-imau]]
insert into configuracion (clave, valor)
values ('choferes_dia_tel', '584146058764')
on conflict (clave) do update set valor = excluded.valor
 where configuracion.clave = 'choferes_dia_tel';

-- ── 2 · HOY YA SALIÓ, A MANO ───────────────────────────────────────────────
-- Se marca el día para que un disparo de esta noche no le mande al IMAU el mismo
-- reporte dos veces. No es una mentira: el del 21/10 lo recibió a las 18:10.
insert into alertas_log (alert_key)
select 'choferes_dia_2026-10-21'
where not exists (select 1 from alertas_log where alert_key = 'choferes_dia_2026-10-21');

-- ── 3 · LA TAREA ───────────────────────────────────────────────────────────
-- ⛔ LA CLAVE VA EN LA LLAMADA. Una tarea sin `Authorization` contesta 401, no
--    manda nada, y el silencio se lee como «no hubo novedades».
select cron.unschedule('choferes-dia-betangar')
 where exists (select 1 from cron.job where jobname = 'choferes-dia-betangar');

-- ⛔ LA CLAVE NO SE ESCRIBE ACÁ. Las tareas de esta base llevan la service key
--    literal en su `command`. Copiarla a este archivo sería meter la credencial
--    en un repo PÚBLICO. Se arma la tarea nueva a partir de una que ya existe,
--    cambiándole solo la URL: la clave nunca sale de la base.
--    [[norma-secreto-nunca-en-el-codigo]]
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'cumpleanos-betangar';
  if v_cmd is null then
    raise exception 'no encontré una tarea de la que copiar los encabezados';
  end if;
  v_cmd := replace(v_cmd, '/functions/v1/cumpleanos', '/functions/v1/choferes-dia');
  if v_cmd not like '%/functions/v1/choferes-dia%' then
    raise exception 'no se pudo apuntar la tarea a choferes-dia';
  end if;
  perform cron.schedule('choferes-dia-betangar', '0 12 * * *', v_cmd);
end $$;

-- ── CONTROL POSITIVO ───────────────────────────────────────────────────────
do $$
declare
  v_tel  text;
  v_job  record;
begin
  select valor into v_tel from configuracion where clave = 'choferes_dia_tel';
  if coalesce(v_tel,'') = '' then
    raise exception 'choferes_dia_tel quedó vacío: la función no mandaría a nadie';
  end if;
  -- ⛔ El dígito importa. Se exige EXACTAMENTE el número verificado contra el chat:
  --    uno con un dígito cambiado también «existe» en WhatsApp y es otra persona.
  if regexp_replace(v_tel, '\D', '', 'g') <> '584146058764' then
    raise exception 'choferes_dia_tel no es el número verificado del IMAU: quedó %', v_tel;
  end if;

  select * into v_job from cron.job where jobname = 'choferes-dia-betangar';
  if v_job is null then raise exception 'la tarea choferes-dia-betangar no quedó creada'; end if;
  if not v_job.active then raise exception 'la tarea quedó INACTIVA'; end if;
  if v_job.schedule <> '0 12 * * *' then
    raise exception 'la tarea no quedó a las 12:00 UTC (8:00 VE): quedó en %', v_job.schedule;
  end if;
  if v_job.command not ilike '%Authorization%' then
    raise exception 'la tarea no lleva la clave: contestaria 401 y el silencio se leeria como que no hubo novedades';
  end if;
  if v_job.command not ilike '%choferes-dia%' then
    raise exception 'la tarea no apunta a la funcion choferes-dia';
  end if;

  if not exists (select 1 from alertas_log where alert_key = 'choferes_dia_2026-10-21') then
    raise exception 'no quedó marcado el día de hoy: el IMAU podría recibirlo dos veces';
  end if;

  raise notice 'OK · 8:00 VE todos los días · destinatario verificado · hoy marcado como ya enviado';
end $$;
