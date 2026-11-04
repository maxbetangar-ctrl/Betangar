-- ════════════════════════════════════════════════════════════════════════════
--  `chofer_del_dia` TIENE QUE DEJAR PASAR AL SERVIDOR.
--
--  LO QUE PASÓ (31/10/2026). La hoja del chofer salía con «JAC-B001 (chofer no
--  declarado)». Se vio recién al renderizar el PDF en un navegador; en los
--  números no se notaba nada. [[norma-una-pantalla-se-revisa-en-una-pantalla]]
--
--  La causa: `chofer_del_dia` pide un rol del padrón (`app_rol()`), y la edge
--  function `ruta-chofer` corre con `service_role`, que NO es un usuario con rol.
--  El candado la rechazaba, el cliente devolvía null y un `?? []` lo convertía en
--  «no hay choferes».
--
--  ⛔ Y NO ERA SÓLO EL NOMBRE: DE ESTA FUNCIÓN SALE EL TELÉFONO. Con la lista
--     vacía, los cinco choferes caían en «no hay telefono del chofer del dia» y
--     el envío NO HABRÍA MANDADO UN SOLO MENSAJE — reportándolo como hecho, con
--     cada uno anotado en `frenados` donde nadie mira.
--     [[norma-falta-de-dato-no-es-un-dato]] [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
--
--  ⚠️ EL CANDADO NO SE AFLOJA PARA NADIE MÁS. Sigue igual: el teléfono de una
--     persona no lo ve cualquiera que tenga sesión. Lo único que entra es la
--     llave de servicio, que vive en el servidor y nunca sale al navegador.
--
--  ⛔⛔ EL PRIMER INTENTO DE ESTE ARCHIVO ABRÍA EL CANDADO DE PAR EN PAR. Preguntaba
--     `current_user in ('service_role', ...)`. Pero `chofer_del_dia` es SECURITY
--     DEFINER: adentro, `current_user` NO es quien llama — es el DUEÑO de la
--     función. O sea que habría dado verdadero para TODO EL MUNDO, incluido un
--     navegador con la llave pública, y los teléfonos de los choferes habrían
--     quedado al alcance de cualquiera con sesión. Se caza leyendo, no probando:
--     «anda» se ve idéntico en los dos casos.
--     Por eso se mira el CLAIM DEL JWT, que describe a quien llama y viene
--     firmado por Supabase: un anónimo no puede fabricarse uno que diga
--     `service_role` sin el secreto. [[norma-no-estar-en-la-lista-no-es-candado]]
--
--  📌 MISMO ERROR DE FONDO, TERCERA VEZ HOY. `cronograma_del_dia` tenía el candado
--     de rol y la misma pieza lo leía como «hoy no salió ninguna parroquia»; ahí
--     se resolvió leyendo la tabla. Acá no se puede: la gracia de esta función es
--     juntar padrón, checklist y planilla.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function _es_el_servidor() returns boolean
language sql stable as $fn$
  -- ⛔ NO `current_user` NI `session_user`: dentro de una función SECURITY DEFINER
  --    valen el dueño, no quien llama, y el candado quedaría abierto para todos.
  --    El claim del JWT describe a quien llama y PostgREST lo pone por conexión.
  select coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           '') = 'service_role'
$fn$;
comment on function _es_el_servidor() is $c$Dice si quien pregunta es el SERVIDOR —una edge function o un cron con la llave de servicio—, no una persona con sesión. Sale del claim `role` del JWT, que PostgREST pone por conexión y viene firmado: sin el secreto no se puede fabricar. ⛔ NO usa `current_user`: dentro de una función SECURITY DEFINER eso devuelve el DUEÑO de la función, no quien llama, y un candado construido así queda abierto para cualquiera. Está para que un candado pensado para personas no deje afuera a nuestras propias piezas — el 31/10 `ruta-chofer` se quedó sin nombres NI TELÉFONOS y el envío habría salido vacío diciendo que estaba hecho.$c$;

-- Se reemplaza sólo el bloque del candado; el resto de la función queda igual.
do $m$
declare v_def text; v_antes text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'chofer_del_dia';

  if v_def is null then
    raise exception 'chofer_del_dia no existe';
  end if;
  v_antes := v_def;

  -- ⛔ Se reemplaza por TEXTO EXACTO y se comprueba que el reemplazo OCURRIÓ. Un
  --    `replace` que no encuentra nada devuelve el original sin avisar, y la
  --    migración diría «listo» sin haber cambiado una coma.
  v_def := replace(v_def,
    'if app_rol() is null',
    'if not _es_el_servidor() and (app_rol() is null');
  v_def := replace(v_def,
    '''mecanico'',''rrhh''])) then',
    '''mecanico'',''rrhh'']))) then');

  if v_def = v_antes
     or position('_es_el_servidor()' in v_def) = 0
     or position('''rrhh'']))) then' in v_def) = 0 then
    raise exception 'el parche del candado no calzo: se aborta sin tocar la funcion';
  end if;

  execute v_def;
end $m$;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $v$
declare v_n int; v_abrio boolean := false;
begin
  -- CONTROL POSITIVO: con el JWT de servicio tiene que DEVOLVER choferes.
  set local request.jwt.claims = '{"role":"service_role"}';
  select count(*) into v_n from chofer_del_dia('2026-10-30');
  if v_n = 0 then
    raise exception 'el servidor sigue sin poder leer el padron de choferes';
  end if;
  raise notice 'OK · con la llave de servicio se leen % chofer(es) del 30/10', v_n;

  -- ⛔ CONTROL NEGATIVO, y es el que importa: el candado tiene que SEGUIR cerrado
  --    para quien no es el servidor. Sin esto, «anda» no distingue entre
  --    arreglado y abierto de par en par — que es justo lo que casi pasa acá.
  set local request.jwt.claims = '{"role":"anon"}';
  begin
    perform * from chofer_del_dia('2026-10-30');
    v_abrio := true;
  exception when others then
    null;   -- lo esperado: el candado lo rechaza
  end;
  if v_abrio then
    raise exception 'EL CANDADO QUEDO ABIERTO: un anonimo pudo leer los telefonos';
  end if;
  raise notice 'OK · el candado sigue cerrado para quien no es el servidor';

  set local request.jwt.claims = '';
end $v$;
