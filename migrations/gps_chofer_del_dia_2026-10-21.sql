-- ════════════════════════════════════════════════════════════════════════════
--  chofer_del_dia — quién manejaba cada unidad ese día, y su teléfono, para
--                   mostrarlo en el mapa del GPS al elegir la unidad.
--  Pedido por Máximo el 21/10/2026.
--
--  ⛔ DE DÓNDE SALE EL DATO, Y POR QUÉ NO DE `planillas`.
--  `planillas` es la verdad operativa de la casa (nómina, Alcaldía, combustible)
--  pero **va atrasada**: medido el 21/10, su último día cargado era el **18/10**,
--  o sea 3 días. Preguntarle «quién maneja HOY» devuelve vacío siempre, y un
--  vacío en pantalla se lee como «nadie maneja esa unidad».
--  El dato fresco está en el **checklist**: lo llena el chofer al salir, y el
--  21/10 tenía las **12 unidades con conductor** y los **12 calzaban** con su
--  ficha de empleado y con teléfono. Cero vacíos, cero sin calce.
--
--  ⚠️ Y esto NO rompe la regla de la casa de que «checklist y viajes_chofer son
--  SOLO vista en tiempo real, no alimentan nada operativo»: esto es exactamente
--  una vista en tiempo real. No calcula nómina ni factura nada.
--
--  LAS DECISIONES
--
--  1. UNA SOLA CONSULTA PARA TODA LA FLOTA, no una por clic. El mapa ya trae las
--     12 unidades de una vez; pedir el chofer de a uno serían 12 viajes y una
--     pantalla que se llena a pedazos.
--
--  2. PARA UN DÍA PASADO MANDA LA PLANILLA; para hoy, el checklist. La planilla
--     es lo DECLARADO y es lo que se le pagó a esa persona; el checklist es lo
--     que se firmó esa mañana. Cuando el día ya está cerrado, la planilla es la
--     que vale.
--
--  3. ⛔ SI LAS DOS EXISTEN Y NO COINCIDEN, SE DICE. Un checklist firmado por
--     uno y una planilla que nombra a otro no es un detalle de pantalla: es una
--     anomalía (o el chofer cambió a mitad de día, o alguien cargó mal la
--     planilla). Se devuelve en `otro_nombre` en vez de elegir en silencio.
--     [[norma-un-numero-que-el-dueno-no-puede-explicar]]
--
--  4. ⛔ EL QUE NO CALZA SE DICE QUE NO CALZA. Si el nombre del checklist no
--     está en `empleados`, se devuelve el nombre igual y `telefono = null` con
--     `nota`. Devolver vacío haría ver «sin chofer» donde hay un chofer con el
--     nombre mal escrito, y mandaría a buscar el problema al lugar equivocado.
--     ⛔ NO se adivina por parecido: un calce por aproximación pondría el
--     teléfono de OTRA persona, y a ese número se le llama.
--     [[norma-la-palabra-que-identifica-es-la-rara]]
--
--  5. EL TELÉFONO SALE COMO LO MANDA LA CASA: `whatsapp` y si no `tel`, el mismo
--     orden que usa la cola de mensajes, normalizado con `tel_para_escribir()`.
--     Dos piezas que contestan «a qué número se le escribe» tienen que contestar
--     lo mismo. [[tel-para-escribir-pieza]]
-- ════════════════════════════════════════════════════════════════════════════

create or replace function chofer_del_dia(p_fecha date default null)
returns table (
  cam          text,
  nombre       text,
  telefono     text,
  wa           text,
  fuente       text,
  hora_salida  text,
  otro_nombre  text,
  nota         text
)
language plpgsql stable security definer set search_path = public as $$
-- ⚠️ `v_fecha` y no `f`: `planillas` tiene una columna que se llama `f`, y una
-- variable con el mismo nombre deja la consulta ambigua y revienta.
declare v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Caracas')::date);
begin
  -- Mismo padrón de roles que lee el GPS en el mapa. ⛔ Acá va el candado de
  -- verdad: el teléfono de una persona no lo ve cualquiera que tenga sesión.
  -- ⛔ VA `= any` NEGADO, NO `<> any`. La primera versión decía
  --    `app_rol() <> any (array[...])`, que es VERDADERO en cuanto el rol
  --    difiere de UNO cualquiera de la lista — o sea que el candado **rechazaba
  --    a todos**, superadmin incluido. Lo cazó el control positivo del final
  --    antes de que llegara a una pantalla; de haber salido así, el síntoma
  --    habría sido «el mapa no muestra choferes» y se habría buscado la falla en
  --    el checklist o en el padrón, que estaban perfectos.
  --    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  -- ⛔ Y EL `is null` VA EXPLÍCITO. Al arreglar el `<> any` se me cayó, y el
  --    control NEGATIVO lo cazó enseguida: con `app_rol()` nulo,
  --    `null = any(array)` da NULL, `not NULL` da NULL, y un `if` con condición
  --    nula NO dispara → el candado DEJABA PASAR a quien no tiene rol. Es el
  --    fail-open de siempre: no estar en la lista no es candado.
  --    [[norma-no-estar-en-la-lista-no-es-candado]]
  if app_rol() is null
     or not (app_rol() = any (array['superadmin','admin','operador','visualizador',
          'directivo','auditor','revisor','operativo','mecanico','rrhh'])) then
    raise exception 'Tu rol no puede ver quién maneja las unidades';
  end if;

  return query
  with ck as (
    select c.cam,
           nullif(trim(c.conductor), '') nom,
           nullif(trim(c.hora_salida::text), '') hora
      from checklist c
     where c.fecha::date = v_fecha
  ), pl as (
    select p.cam, nullif(trim(p.ch), '') nom
      from planillas p
     where p.f::date = v_fecha
  ), elegido as (
    -- Para un día cerrado manda la planilla; si no hay, el checklist (decisión 2).
    select coalesce(pl.cam, ck.cam) cam,
           coalesce(pl.nom, ck.nom) nom,
           case when pl.nom is not null then 'planilla' else 'checklist' end fuente,
           ck.hora,
           -- decisión 3: si las dos existen y difieren, se dice.
           case when pl.nom is not null and ck.nom is not null
                     and upper(pl.nom) <> upper(ck.nom)
                then ck.nom end otro
      from pl full join ck on ck.cam = pl.cam
  )
  select e.cam,
         e.nom,
         -- decisión 5: el mismo orden que la cola de mensajes.
         case when emp.id is null then null
              else coalesce(nullif(emp.whatsapp, ''), nullif(emp.tel, '')) end,
         case when emp.id is null then null
              else tel_para_escribir(coalesce(nullif(emp.whatsapp, ''), nullif(emp.tel, ''))) end,
         e.fuente,
         e.hora,
         e.otro,
         case
           when e.nom is null then 'nadie firmó el checklist de esta unidad todavía'
           when emp.id is null then 'ese nombre no figura en el padrón de empleados: no se puede dar un teléfono'
           when coalesce(nullif(emp.whatsapp, ''), nullif(emp.tel, '')) is null
             then 'está en el padrón pero su ficha no tiene teléfono'
           when e.otro is not null
             then 'el checklist lo firmó otra persona: hay que revisar cuál es la buena'
         end
    from elegido e
    -- ⛔ Calce EXACTO por nombre y nada más (decisión 4).
    left join empleados emp on upper(trim(emp.nombre)) = upper(trim(e.nom))
   where e.cam is not null
   order by e.cam;
end $$;

comment on function chofer_del_dia(date) is
  'Quién manejaba cada unidad ese día + su teléfono, para el mapa del GPS. Día de hoy: '
  'sale del checklist (`planillas` va días atrasada y daría vacío siempre). Día cerrado: '
  'manda la planilla. Si las dos difieren lo dice en `otro_nombre`. El que no calza con el '
  'padrón devuelve el nombre y `telefono` nulo con el motivo escrito en `nota`: nunca vacío '
  'en silencio, y nunca un calce por parecido.';

revoke all on function chofer_del_dia(date) from anon;

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
-- ⛔ Sin esto, «quedó» es una impresión. Y el modo de fallar de esta función es
-- callado: devolver 0 filas se ve igual que «hoy no salió nadie».
-- ⚠️ Y ESTE CONTROL TIENE QUE HACERSE PASAR POR UN USUARIO DE LA APP. La consola
-- corre como `postgres`, donde `app_rol()` es NULO, así que el propio candado
-- rechaza la prueba. ⛔ La salida fácil habría sido dejar pasar el nulo, y eso es
-- justo el fail-open que esta casa ya pagó: «no estar en la lista no es candado».
-- Se declara el `sub` de un admin REAL en la sesión (local a la transacción), que
-- además prueba el candado por el lado bueno: con rol, deja; sin rol, niega.
do $$
declare n int; sin_tel int; hoy date := (now() at time zone 'America/Caracas')::date;
        uid text; nego boolean := false;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  if uid is null then
    raise exception 'CONTROL: no hay un admin con `auth_user_id` para probar el candado';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  select count(*) into n from chofer_del_dia(hoy);
  if n < 10 then
    raise exception 'CONTROL: chofer_del_dia(hoy) devolvió % filas; el 21/10 había 12 '
      'unidades con conductor en el checklist. O la consulta está mal o mide otra cosa.', n;
  end if;

  select count(*) into sin_tel from chofer_del_dia(hoy) where telefono is null;
  if sin_tel = n then
    raise exception 'CONTROL: NINGUNA fila trajo teléfono (% de %). Medido el 21/10, los 12 '
      'conductores calzaban con su ficha: si ahora no calza ninguno, el cruce está roto.', sin_tel, n;
  end if;

  -- Un día sin nada tiene que devolver VACÍO, no la flota entera: si devolviera
  -- filas para cualquier fecha, estaría ignorando el día y mostrando el de hoy.
  if (select count(*) from chofer_del_dia('2020-01-01'::date)) <> 0 then
    raise exception 'CONTROL: un día sin datos devolvió filas. La función ignora la fecha.';
  end if;

  -- ⛔ Y EL CANDADO TIENE QUE NEGARSE DE VERDAD. Sin esta mitad, lo de arriba
  -- probaría que la función anda, no que el teléfono esté protegido: un candado
  -- que nunca se vio negar no se sabe si cierra.
  perform set_config('request.jwt.claims', json_build_object('sub',
            '00000000-0000-0000-0000-000000000000')::text, true);
  begin
    perform count(*) from chofer_del_dia(hoy);
  exception when others then
    if position('no puede ver' in sqlerrm) > 0 then nego := true; else raise; end if;
  end;
  if not nego then
    raise exception 'CONTROL: un usuario SIN rol pudo ver los teléfonos de los choferes';
  end if;

  raise notice 'OK · % unidades con chofer hoy, % sin teléfono · día vacío devuelve vacío · '
    'y a quien no tiene rol se le NIEGA', n, sin_tel;
end $$;
