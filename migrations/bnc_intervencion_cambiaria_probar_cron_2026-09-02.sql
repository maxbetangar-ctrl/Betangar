-- ════════════════════════════════════════════════════════════════════════════════════════════
-- PROBAR EL CRON DE `divisas-banco` — disparando lo que el cron va a disparar  (02/09/2026)
--
-- 🔬 POR QUÉ. Un cron creado no es un cron que funciona: la fila puede estar perfecta y el
--    `net.http_post` devolver 401 porque la cabecera se copió mal, o 404 porque la función no
--    está. Eso no se vería hasta que alguien echara de menos un aviso que nunca llegó — y un
--    canal de entrega caído se ve igual que todo en orden.
--    [[norma-mirar-la-ultima-corrida-no-la-existencia]] · [[norma-probar-el-camino-no-la-pieza]]
--
-- 📌 NO se prueba con `curl`: se ejecuta **el comando del propio cron**, leído de `cron.job`. Es
--    la única forma de comprobar las cabeceras que va a mandar él, no las que yo escribiría.
--    `curl` ya dijo «bien» dos veces con la pantalla rota.
--
-- ⛔ ESTO NO LE ESCRIBE A NADIE. Va con `dry=1`, que arma los avisos y los devuelve sin encolar
--    nada. Y aunque no lo llevara: fuera de la franja 8:00–20:00 la función tampoco manda.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ⛔⛔ LEER ESTO ANTES DE TOCARLO. El primer intento hacía `order by id desc limit 1` sobre
--    `net._http_response`, o sea «la última respuesta que llegó». Dio **HTTP 200 · ok=true**…
--    y era de **`gps-sondeo`**, que corre CADA MINUTO. La prueba pasó por el motivo equivocado
--    y con evidencia de otro. Solo se vio porque el control preguntaba por el contenido.
--    Hay que quedarse con el ID que devuelve la llamada y buscar ESA respuesta.
--    [[norma-test-que-pasa-por-el-motivo-equivocado]] · [[norma-control-positivo-antes-de-creerle-al-vacio]]

create temporary table _pc_log(paso text, detalle text) on commit preserve rows;
create temporary table _pc_rid(rid bigint) on commit preserve rows;

-- ── 1) Disparar el comando del cron, cambiándole solo `origen` por `dry=1` ───────────────────
do $$
declare c text; r bigint;
begin
  select replace(command, 'divisas-banco?origen=cron', 'divisas-banco?dry=1')
    into c from cron.job where jobname = 'divisas-banco-manana';
  if c is null then raise exception 'no existe el cron `divisas-banco-manana`'; end if;
  -- `net.http_post` devuelve el id de la petición: es lo que ata la respuesta a ESTA llamada.
  execute trim(trailing ' ;' from c) into r;
  insert into _pc_rid values (r);
end $$;

-- `pg_net` responde de forma asíncrona: hay que darle tiempo antes de mirar el resultado.
-- ⚠️ 5 segundos NO alcanzaban: la función corre `bnc_clasificar()` sobre los ~2.900 movimientos
-- antes de contestar. Con 5s la prueba decía «TODAVÍA SIN RESPUESTA» y había que ir a buscar la
-- fila a mano. 20 da aire de sobra. Si vuelve a salir sin respuesta, NO es que falle: se mira
-- `select status_code, content from net._http_response where id = <la petición que dice arriba>`.
select pg_sleep(20);

-- ── 2) QUÉ CONTESTÓ — la respuesta de ESTA petición, buscada por su id ───────────────────────
-- Un 401 significa que la cabecera `x-api-key` no viajó bien; un 404, que la función no está.
insert into _pc_log
select '1. respuesta',
       'petición #'||r.rid||' → HTTP '||coalesce(x.status_code::text,'(TODAVÍA SIN RESPUESTA)')||
       ' · ok='||coalesce((x.content like '%"ok":true%')::text,'?')||
       ' · '||coalesce(left(x.content, 260),'(vacío)')
  from _pc_rid r left join net._http_response x on x.id = r.rid;

-- ⛔ CONTROL POSITIVO: que la respuesta sea DE VERDAD la de esta función y no la de otra que
-- pasó por ahí. Si esto dice `false`, el HTTP 200 de arriba no vale nada.
insert into _pc_log
select '2. control', 'es la respuesta de divisas-banco (menciona las 2 operaciones): '||
       coalesce((x.content like '%"operaciones":2%')::text,'sin respuesta')
  from _pc_rid r left join net._http_response x on x.id = r.rid;

select * from _pc_log order by paso;

-- ⏱️ Y MAÑANA, después de las 9:00, la corrida DE VERDAD:
--    select j.jobname, d.status, d.return_message, d.start_time
--      from cron.job_run_details d join cron.job j using (jobid)
--     where j.jobname like 'divisas-banco%' order by d.start_time desc limit 5;
