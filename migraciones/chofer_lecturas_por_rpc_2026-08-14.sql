-- ════════════════════════════════════════════════════════════════════════════════════════════
--  RÉPLICA A BETANGAR de la migración homónima de `flotilla-app` (15/08/2026).
--  Se comprobó ANTES de copiar que las 4 tablas del chofer son IDÉNTICAS en las dos bases:
--  102 columnas cada una, cero diferencias, y los 4 índices únicos con el mismo nombre.
--  Por eso va sin adaptar. El texto original sigue abajo tal cual.
--  ⚠️ Esta base la comparte GEPPETTO (tablas edu_* / usdt_*): nada de esto las toca.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  CERRAR LA LECTURA DE `anon`: el telefono pregunta POR SU UNIDAD, no por la flota entera
--  FLOTILLA · 2026-08-14   (parte 2 del blindaje; la parte 1 cerro la ESCRITURA)
--
--  EL PROBLEMA QUE QUEDABA
--  Con la llave `anon` del JS publico se podia LEER la operacion completa del cliente: los 866
--  viajes, los 291 checklists, las mediciones de combustible y los odometros de toda la flota,
--  desde cualquier lugar del mundo. La escritura ya se cerro; esto es la otra mitad.
--
--  POR QUE NO SE HIZO CON UNA VENTANA DE FECHAS
--  Se evaluo y se descarto. `chofer.html` pregunta "¿hay un checklist mas nuevo que X?" sin tope
--  de fecha: con una ventana, esa consulta devolveria una respuesta FALSA en vez de un error, y
--  el chofer veria un estado de unidad que ya no corre. Un candado que hace mentir a una pantalla
--  es peor que el agujero [[norma-la-vista-no-mide-lo-que-crees]].
--
--  COMO SE CIERRA
--  Las 9 lecturas de `chofer.html` piden, TODAS, lo de UNA unidad (`.eq('cam', cam)`). Se pasan a
--  RPC `security definer` que reciben la unidad y devuelven solo lo suyo. Despues se le quita a
--  `anon` el SELECT directo sobre las tablas.
--
--  QUE PROTEGE Y QUE NO -- decirlo, no dejarlo creer
--  Protege contra el barrido: ya no se puede pedir "todo". Para ver algo hay que saber el codigo
--  de una unidad, y solo se ve esa. NO es autenticacion: el codigo de unidad va en el QR que
--  escanea el chofer. La autenticacion de verdad exigiria la credencial del chofer, y no se puede
--  pedir aca porque dos de estas lecturas ocurren al CARGAR la pagina, antes de que el chofer del
--  dia este elegido -- pedirsela trancaria el arranque.
--
--  Es el mismo patron que la app YA usa en `entregas_del_dia`, `unidad_publica`, `tanque_de_unidad`
--  y `choferes_publicos` [[norma-bitacora-nombrar-la-pieza-que-ya-existe]].
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Viajes del dia de UNA unidad  (reemplaza L2572) ──────────────────────────────────────
create or replace function public.chofer_viajes_dia(p_cam text, p_fecha text)
returns setof public.viajes_chofer
language sql security definer stable set search_path = public as $$
  select * from public.viajes_chofer where cam = p_cam and fecha = p_fecha
$$;

-- ── 2. Cuantos viajes lleva la unidad en el rango  (reemplaza L2603) ────────────────────────
-- Devuelve el numero, no las filas: la pantalla solo muestra un contador.
create or replace function public.chofer_viajes_cuenta(p_cam text, p_desde text, p_hasta text)
returns integer
language sql security definer stable set search_path = public as $$
  select count(*)::int from public.viajes_chofer
   where cam = p_cam and fecha >= p_desde and fecha <= p_hasta
$$;

-- ── 3. Checklist del dia de UNA unidad  (reemplaza L3019) ───────────────────────────────────
create or replace function public.chofer_checklist_dia(p_cam text, p_fecha text)
returns setof public.checklist
language sql security definer stable set search_path = public as $$
  select * from public.checklist where cam = p_cam and fecha = p_fecha limit 1
$$;

-- ── 4. ¿Hay un checklist mas nuevo que este?  (reemplaza L822) ──────────────────────────────
-- Sin tope de fecha A PROPOSITO: es la consulta que hacia imposible la ventana. Aca no hace
-- daño porque solo devuelve un booleano de UNA unidad -- no expone ninguna fila.
create or replace function public.chofer_checklist_hay_mas_nuevo(p_cam text, p_fecha text)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.checklist where cam = p_cam and fecha > p_fecha)
$$;

-- ── 5. Estado y odometro de UNA unidad  (reemplaza L825 y L3015) ────────────────────────────
create or replace function public.chofer_unidad_km(p_cam text)
returns table(km integer, estado text, estado_desde date, nota_estado text)
language sql security definer stable set search_path = public as $$
  select k.km, k.estado, k.estado_desde, k.nota_estado
    from public.km_data k where k.cam = p_cam limit 1
$$;

-- ── 6. Medicion de combustible de UNA unidad  (reemplaza L3061) ─────────────────────────────
create or replace function public.chofer_medicion(p_cam text, p_fecha date, p_momento text)
returns numeric
language sql security definer stable set search_path = public as $$
  select altura_cm from public.combustible_mediciones
   where vehiculo_id = p_cam and fecha = p_fecha and momento = p_momento limit 1
$$;

-- ── 7. ¿Hay conexion?  (reemplaza L1477 y L2920) ────────────────────────────────────────────
-- Esas dos lineas leian `viajes_chofer` solo para saber si habia internet. No necesitaban un
-- solo dato de la empresa para eso.
create or replace function public.hay_conexion()
returns boolean
language sql security definer stable set search_path = public as $$ select true $$;

-- ── Permisos: las RPC son para el telefono; la oficina entra por su propio camino ───────────
revoke all on function public.chofer_viajes_dia(text,text)              from public;
revoke all on function public.chofer_viajes_cuenta(text,text,text)      from public;
revoke all on function public.chofer_checklist_dia(text,text)           from public;
revoke all on function public.chofer_checklist_hay_mas_nuevo(text,text) from public;
revoke all on function public.chofer_unidad_km(text)                    from public;
revoke all on function public.chofer_medicion(text,date,text)           from public;
revoke all on function public.hay_conexion()                            from public;

grant execute on function public.chofer_viajes_dia(text,text)              to anon, authenticated;
grant execute on function public.chofer_viajes_cuenta(text,text,text)      to anon, authenticated;
grant execute on function public.chofer_checklist_dia(text,text)           to anon, authenticated;
grant execute on function public.chofer_checklist_hay_mas_nuevo(text,text) to anon, authenticated;
grant execute on function public.chofer_unidad_km(text)                    to anon, authenticated;
grant execute on function public.chofer_medicion(text,date,text)           to anon, authenticated;
grant execute on function public.hay_conexion()                            to anon, authenticated;

commit;

-- ⚠️ EL SELECT DIRECTO DE `anon` NO SE QUITA EN ESTE ARCHIVO.
-- Primero tiene que estar desplegada la app que usa las RPC. Si se quitara ahora, la version
-- vieja que los telefonos tienen en cache se queda ciega -- y un chofer sin app es la operacion
-- parada. Se quita en `chofer_lecturas_cerrar_select.sql`, DESPUES de ver la app nueva andando.
