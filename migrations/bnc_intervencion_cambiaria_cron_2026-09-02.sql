-- ════════════════════════════════════════════════════════════════════════════════════════════
-- CRON de `divisas-banco` — avisar cuando el banco compra dólares por su cuenta  (02/09/2026)
--
-- ⛔ Correr DESPUÉS de `bnc_intervencion_cambiaria_2026-09-02.sql` y de desplegar la función.
--    Un cron que llama a una función que no existe falla en silencio y no se entera nadie.
--
-- 🔑 EL COMANDO NO LLEVA NINGUNA CLAVE ESCRITA. Se copia el del cron `bnc-traer-manana`, que ya
--    vive en la base, y solo se le cambia la URL. Este repo es PÚBLICO: una `apikey` o un
--    `x-api-key` en un archivo de acá queda publicado, y borrarlo después no lo rota — queda en
--    el historial de git. [[norma-secreto-nunca-en-el-codigo]]
--
-- ⏰ LAS HORAS. `bnc-traer` baja el estado de cuenta a las 11:00, 17:00 y 23:00 UTC (7:00, 13:00
--    y 19:00 de Venezuela). Esto corre DESPUÉS de las dos primeras:
--      13:00 UTC =  9:00 de Venezuela
--      21:30 UTC = 17:30 de Venezuela
--    Las dos caen dentro de la franja 8:00–20:00 en que se le puede escribir a una persona. Y la
--    función lo vuelve a comprobar por su cuenta: si alguien mueve el cron a una hora de
--    madrugada, no manda y deja el aviso para la corrida siguiente en vez de perderlo.
--    [[norma-hora-del-destinatario-antes-de-enviar]]
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table _cr_log(paso text, detalle text) on commit preserve rows;

-- ── 0) De dónde se copia el comando ─────────────────────────────────────────────────────────
-- Si el cron modelo no existiera, esto para acá en vez de crear un cron mudo.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'bnc-traer-manana') then
    raise exception 'no está el cron `bnc-traer-manana`, que es de donde se copian las cabeceras';
  end if;
end $$;

-- ── 1) Los dos horarios ─────────────────────────────────────────────────────────────────────
select cron.schedule(
  'divisas-banco-manana', '0 13 * * *',
  replace((select command from cron.job where jobname = 'bnc-traer-manana'),
          'bnc-traer?origen=cron', 'divisas-banco?origen=cron'));

select cron.schedule(
  'divisas-banco-tarde', '30 21 * * *',
  replace((select command from cron.job where jobname = 'bnc-traer-manana'),
          'bnc-traer?origen=cron', 'divisas-banco?origen=cron'));

-- ── 2) CONTROL ──────────────────────────────────────────────────────────────────────────────
-- Que el reemplazo haya funcionado de verdad: si la URL siguiera diciendo `bnc-traer`, el cron
-- estaría bajando el estado de cuenta dos veces más y no avisaría nunca.
insert into _cr_log
select '1. creados', jobname||' · '||schedule||' · activo='||active::text||
       ' · apunta a divisas-banco: '||(command like '%/divisas-banco?origen=cron%')::text
  from cron.job where jobname like 'divisas-banco%';

insert into _cr_log
select '2. sin claves sueltas', 'el comando se copió del cron existente, no se escribió acá: '||
       (count(*) = 2)::text
  from cron.job where jobname like 'divisas-banco%' and command like '%apikey%';

select * from _cr_log order by paso;

-- ⏱️ Y DESPUÉS: que exista no prueba que corra. A las 24 h, mirar la ÚLTIMA CORRIDA, no la fila:
--    select jobname, status, return_message, start_time
--      from cron.job_run_details d join cron.job j using (jobid)
--     where j.jobname like 'divisas-banco%' order by start_time desc limit 5;
--    [[norma-mirar-la-ultima-corrida-no-la-existencia]]
