-- ═══════════════════════════════════════════════════════════════════════════
-- CONTESTAR UNA DENUNCIA CON UN PUNTO: ¿pasó un camión por ahí, y a qué hora?
--
-- 🔴 PARA QUÉ (30/10/2026). Máximo: *«si yo te envío una ubicación GPS de una
--    denuncia de que no se recogió, ¿tenés cómo darme respuesta rápido de si
--    pasó por ese punto y la hora?»*. La pieza que contesta eso ya existe
--    (`paso_por_aqui`, 747 ms para un día y 5,1 s para una semana, medido hoy),
--    pero **contestarlo exige abrir una sesión en la computadora**. Lo que falta
--    es que se pueda preguntar desde el teléfono, por la puerta de WhatsApp
--    (`atenderAlDueno`), que es donde ya vive «preguntarle un dato a la base».
--
-- Esta migración hace DOS cosas, y conviene leerlas por separado.
--
-- ── 1 · `gps_ve_o_falla` deja pasar a `service_role` ────────────────────────
--
--    El candado exige un rol del negocio leído de `btg_usuarios` por
--    `auth.uid()`. La puerta de WhatsApp llama con la clave `service_role` y
--    **sin usuario**, así que `app_rol()` da null y el candado la rechaza. Eso
--    es justamente el pendiente escrito: «falta una SESIÓN para lo que exige rol
--    del negocio».
--
--    ⛔ Y POR QUÉ ESTO NO ABRE NADA QUE NO ESTUVIERA ABIERTO: quien tiene la
--    clave `service_role` **ya puede hacer `select * from gps_posiciones`**
--    directo — esa clave salta RLS por definición. El candado nunca protegió
--    contra ella: protege contra un usuario de la app SIN el rol del negocio, y
--    eso sigue igual. Lo que se gana es que la puerta pueda llamar a las
--    funciones del GPS sin que haya que inventarle una sesión de persona.
--    ⚠️ `anon` NO entra: `anon` tampoco tiene uid, pero su `current_user` es
--    `anon`, no `service_role`. La prueba de abajo lo comprueba, porque la
--    diferencia entre «sin usuario» y «service_role» es TODO el candado.
--    [[norma-control-positivo-antes-de-creerle-al-vacio]]
--
-- ── 2 · `gps_denuncia_en_punto`: una sola función que contesta la denuncia ──
--
--    La puerta llama UNA función y manda lo que devuelve. Así que acá se compone
--    lo que hoy son dos consultas (`paso_por_aqui` + `zona_en_punto`) y se
--    devuelve **un texto listo para leer**, con lo que decide una denuncia:
--    qué camión, a qué hora, a cuántos metros, y **cuántos minutos estuvo
--    detenido ahí** — porque `velocidad 0` cuatro minutos a 20 metros no es
--    «pasó de largo», es «se detuvo a recoger», y eso es lo que gana la
--    discusión con el IMAU.
--
--    ⛔ UN PUNTO FUERA DEL ÁREA NO SE CONTESTA «NO PASÓ NADIE». Medido hoy sobre
--    las 322.305 posiciones: la flota se mueve entre lat 10,4592 y 10,7351 y lon
--    -71,9653 y -71,5910. Un punto fuera de eso (una coordenada mal tecleada, o
--    una denuncia de otra ciudad) devuelve «ese punto está fuera del área donde
--    opera la flota», nunca «no pasó nadie»: la falta de un dato no es un dato.
--    [[norma-falta-de-dato-no-es-un-dato]]
--
--    ⛔ Y DICE DESDE CUÁNDO HAY HISTORIAL. El GPS arranca el 14/08/2026. Una
--    denuncia anterior a esa fecha no se puede contestar, y el texto lo aclara
--    en vez de devolver cero pasos con cara de respuesta.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · el candado ─────────────────────────────────────────────────────────
create or replace function public.gps_ve_o_falla()
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  -- La puerta de WhatsApp y las piezas de la casa llaman con `service_role`, que
  -- ya lee `gps_posiciones` directo: el candado nunca fue una barrera para ella.
  -- Va PRIMERO para que no dependa de `app_rol()`, que para esa clave es null.
  --
  -- ⛔ Y SE PREGUNTA POR EL CLAIM DEL JWT, NO POR `current_user`. Primera
  --    versión de esto (30/10/2026): `if current_user = 'service_role'`. Adentro
  --    de una función `SECURITY DEFINER` **`current_user` es el DUEÑO** —acá
  --    `postgres`— no quien llama, así que la cláusula no se cumplía nunca y la
  --    puerta seguía rechazada. No era peligrosa, era inerte: lo peor de los dos
  --    mundos, porque el permiso parecía concedido y el candado seguía cerrado.
  --    El claim distingue de verdad: `anon` para el público, `authenticated`
  --    para un usuario de la app, `service_role` para la clave de servicio.
  if coalesce(
       nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
       '') = 'service_role' then
    return true;
  end if;

  -- ⛔ El `is null` va EXPLÍCITO: `null = any(array)` da NULL, `not NULL` da NULL,
  -- y un `if` con condición nula NO dispara. Sin esta línea el candado deja
  -- pasar justo a quien no tiene rol. Ya mordió en `chofer_del_dia`.
  if app_rol() is null
     or not (app_rol() = any (array['superadmin','admin','operador','visualizador',
          'directivo','auditor','revisor','operativo','mecanico','rrhh'])) then
    raise exception 'Tu usuario no tiene permiso para consultar el recorrido de la flota';
  end if;
  return true;
end $function$;

-- ── 2 · la respuesta a la denuncia ─────────────────────────────────────────
create or replace function public.gps_denuncia_en_punto(
  p_lat double precision,
  p_lon double precision,
  p_dias integer default 7,
  p_radio_m integer default 120
)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  -- El área donde opera la flota, medida el 30/10/2026 sobre 322.305 posiciones
  -- (min/max de lat y lon) con un margen de 0,05° (~5,5 km) para no rechazar una
  -- denuncia en el borde de una ruta.
  LAT_MIN constant double precision := 10.4592 - 0.05;
  LAT_MAX constant double precision := 10.7351 + 0.05;
  LON_MIN constant double precision := -71.9653 - 0.05;
  LON_MAX constant double precision := -71.5910 + 0.05;
  HISTORIAL_DESDE constant date := date '2026-08-14';
  v_desde date;
  v_dias integer;
  v_radio integer;
  v_out text;
  v_n integer;
  v_zona record;
  r record;
begin
  perform gps_ve_o_falla();

  if p_lat is null or p_lon is null then
    return '⛔ No llegó la ubicación. Mandá el punto y lo reviso.';
  end if;

  if p_lat not between LAT_MIN and LAT_MAX or p_lon not between LON_MIN and LON_MAX then
    return format(
      '⛔ Ese punto (%s, %s) está FUERA del área donde opera la flota.'
      || E'\nNo es que no haya pasado nadie: es que ahí no trabajamos. Revisá la coordenada.',
      round(p_lat::numeric, 5), round(p_lon::numeric, 5));
  end if;

  -- Topes: una denuncia se contesta con días, no con meses, y el rango largo es
  -- lo que hace lenta la consulta (medido: 1 día 747 ms, 7 días 5,1 s).
  v_dias := least(greatest(coalesce(p_dias, 7), 1), 31);
  v_radio := least(greatest(coalesce(p_radio_m, 120), 30), 500);
  v_desde := (current_date - (v_dias - 1));

  v_out := format('📍 %s, %s · radio %s m · últimos %s día(s)',
    round(p_lat::numeric, 5), round(p_lon::numeric, 5), v_radio, v_dias);

  if v_desde < HISTORIAL_DESDE then
    v_out := v_out || format(E'\n⚠️ El GPS tiene historial desde el %s: antes de esa fecha no hay nada que mirar.',
      to_char(HISTORIAL_DESDE, 'DD/MM/YYYY'));
    v_desde := HISTORIAL_DESDE;
  end if;

  -- A quién le toca ese punto. Puede no caer en ninguna de las 34 zonas: eso se
  -- dice, no se omite.
  select * into v_zona from zona_en_punto(p_lat, p_lon) limit 1;
  if v_zona.cam is not null then
    v_out := v_out || format(E'\n🗺️ Le toca a %s (%s) · %s zona %s · calle «%s» a %s m',
      v_zona.cam, coalesce(v_zona.por, 'sin chofer asignado'),
      coalesce(v_zona.parroquia, '?'), coalesce(v_zona.zona::text, '?'),
      coalesce(v_zona.calle, '?'), coalesce(v_zona.a_metros::text, '?'));
  else
    v_out := v_out || E'\n🗺️ Ese punto no cae en ninguna de las 34 zonas asignadas: no hay un camión responsable que nombrar.';
  end if;

  v_n := 0;
  for r in
    select f, cam, hora, dist_m, por, velocidad, min_del_tramo
      from paso_por_aqui(p_lat, p_lon, v_radio, v_desde, current_date)
     order by hora desc
     limit 12
  loop
    if v_n = 0 then v_out := v_out || E'\n\n✅ SÍ pasó:'; end if;
    v_n := v_n + 1;
    v_out := v_out || format(E'\n· %s  %s  a %s m  ·  %s',
      to_char(r.hora at time zone 'America/Caracas', 'DD/MM HH24:MI'),
      r.cam, r.dist_m,
      case
        -- Lo que decide una denuncia no es que pasara: es que se DETUVIERA.
        when coalesce(r.velocidad, 0) = 0 and coalesce(r.min_del_tramo, 0) >= 1
          then format('DETENIDO %s min ahí', round(r.min_del_tramo, 1))
        when coalesce(r.velocidad, 0) = 0 then 'parado un momento'
        else format('pasando a %s km/h', round(r.velocidad, 0))
      end);
  end loop;

  if v_n = 0 then
    v_out := v_out || format(E'\n\n🔴 NO pasó ningún camión a menos de %s m de ese punto entre el %s y hoy.',
      v_radio, to_char(v_desde, 'DD/MM'));
  elsif v_n = 12 then
    v_out := v_out || E'\n(hay más de 12: se muestran los 12 más recientes)';
  end if;

  return v_out;
end $function$;

-- ⛔ TODA FUNCIÓN NACE ABIERTA A `public`: lo que no se revoca, queda abierto.
--    [[norma-toda-funcion-nace-abierta-a-public]]
revoke all on function public.gps_denuncia_en_punto(double precision, double precision, integer, integer) from public;
revoke all on function public.gps_denuncia_en_punto(double precision, double precision, integer, integer) from anon;
grant execute on function public.gps_denuncia_en_punto(double precision, double precision, integer, integer) to authenticated;
grant execute on function public.gps_denuncia_en_punto(double precision, double precision, integer, integer) to service_role;

comment on function public.gps_denuncia_en_punto(double precision, double precision, integer, integer) is
  'Contesta una denuncia de "no se recogió" con un punto: si pasó un camión, cuál, a qué hora, a cuántos metros y si estuvo DETENIDO ahí. Dice a qué camión le toca ese punto y avisa cuando el punto está fuera del área de la flota o la fecha es anterior al historial del GPS (14/08/2026).';

commit;
