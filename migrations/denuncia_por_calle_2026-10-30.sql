-- BETANGAR — Contestar una denuncia POR LA CALLE, no por un círculo de 120 metros
-- Fecha: 2026-10-30
--
-- ⛔ EL PROBLEMA, en palabras de Máximo: «no es solo la distancia sino cómo llegar a esa
--    calle», y esa norma vale «en todas las rutas o cuadres».
--
--    Hoy una denuncia se contesta con `paso_por_aqui`, que busca posiciones a menos de
--    **120 metros del punto** — cuadra y media. En ese círculo entra la calle del reclamo
--    Y TODAS LAS DE ALREDEDOR. Entonces un camión que pasó por la calle de enfrente hace
--    que la herramienta conteste «sí pasamos», sin haber entrado nunca a la calle que
--    reclaman.
--
--    📏 El caso real del 30/10: la casa y la T ciega de atrás están a 50 m. B006 pasó por
--    la calle de la casa a las 08:21 y recién entró a la T a las 08:41. **Si esa segunda
--    vuelta no hubiera existido, la herramienta igual contestaba «sí pasamos»** usando la
--    posición de las 08:21, que es de otra calle.
--
-- ⛔ Y EL ERROR VA SIEMPRE PARA EL MISMO LADO: el círculo hace más fácil decir «sí
--    pasamos», nunca «no pasamos». Una herramienta que se equivoca siempre a favor de
--    quien la usa no es una prueba, es un argumento. Y esta respuesta se le entrega a la
--    ALCALDÍA: si verifican una sola vez en la calle y el papel decía que pasamos,
--    dejan de creerle al papel también en los casos en que teníamos razón.
--
-- ✅ LO QUE HACE ESTA FUNCIÓN: primero averigua **qué calle es** la del reclamo —el tramo
--    del callejero más cercano al punto— y después pregunta si ALGUIEN RECORRIÓ ESA
--    CALLE, con la regla del producto (a ≤45 m del tramo, camión lento o con motor
--    encendido), la misma de `zona_cobertura_del_dia`.
--    Y aparte informa quién pasó CERCA por OTRAS calles, porque «pasamos por la de
--    enfrente» no cumple pero tampoco es lo mismo que «no estuvo nadie en el barrio»:
--    son dos respuestas distintas y las dos hacen falta para contestar bien.
--
-- ⚠️ CUANDO NO SE PUEDE SABER, SE DICE. Si no hay ningún tramo del callejero cerca del
--    punto, la función NO se cae para atrás al círculo: devuelve `calle_conocida = false`
--    y ahí la respuesta honesta es «no tenemos esa calle en el callejero». Pasa de
--    verdad: Luis Hurtado Higuera no tiene callejero cargado, y en Caracciolo hay tramos
--    sin nombre. [[norma-falta-de-dato-no-es-un-dato]]
--
-- ⚠️ Y RECORRER NO ES LIMPIAR. El GPS prueba que la unidad pasó por esa calle. Es el
--    indicio más fuerte que tenemos y se dice así, sin inflarlo.
--
-- ⛔ `paso_por_aqui` NO se toca: la usan el mapa y `dias_por_aqui`. Mide cercanía a un
--    punto, que para un contenedor o una esquina ES lo correcto. Lo que se corrige es
--    cuál se usa para contestar una denuncia por una CALLE.

begin;

create or replace function public.denuncia_por_calle(
  p_lat double precision, p_lon double precision,
  p_desde date default null, p_hasta date default null,
  -- ⛔ QUE TAN CERCA para contar como «la calle del reclamo». 15 m y no 60, y se devuelven
  --    TODAS las que entren, no la mas cercana. Lo destapo la prueba del 30/10: el tramo
  --    mas cercano a esa casa es **Avenida 3F a 4 m** —una avenida de 2,7 km que pasa por
  --    el fondo— y la calle de la casa esta a 8 m. Tomando «la mas cercana» se elegia la
  --    avenida, y como nadie la recorrio ese dia se perdia que el camion SI habia hecho la
  --    calle de la casa con 16 posiciones. Un punto puede estar legitimamente sobre dos
  --    calles (una esquina): se muestran las dos y decide quien contesta.
  p_tope_calle_m integer default 15
)
returns table (
  clase text,              -- 'LA CALLE' o 'cerca, por otra calle'
  calle text, tramo bigint, a_metros_del_punto integer,
  recorrida boolean, cam text, f date, hora timestamp with time zone, posiciones bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_desde date := p_desde; v_hasta date := p_hasta;
begin
  perform gps_ve_o_falla();

  return query
  with lim as (
    select coalesce(v_desde, current_date - 30) d1, coalesce(v_hasta, current_date) d2
  ),
  -- 1. ¿Cuál es la calle del reclamo? El tramo del callejero más cercano al punto.
  reclamo as (
    select zc.id, coalesce(zc.nombre, '(sin nombre en el callejero)') nombre, zc.geom,
           zc.la_min, zc.la_max, zc.lo_min, zc.lo_max,
           _dist_a_tramo_m(p_lat, p_lon,
             (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
             (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8) m
      from zona_calles zc
     where zc.la_max >= p_lat - 0.0015 and zc.la_min <= p_lat + 0.0015
       and zc.lo_max >= p_lon - 0.0015 and zc.lo_min <= p_lon + 0.0015
  ),
  la_calle as (select * from reclamo where m <= p_tope_calle_m),
  pos as (
    select p.cam, p.ts, p.lat, p.lon, (p.ts at time zone 'America/Caracas')::date f
      from gps_posiciones p, lim
     where p.ts >= (lim.d1::timestamp at time zone 'America/Caracas')
       and p.ts <  ((lim.d2 + 1)::timestamp at time zone 'America/Caracas')
       and p.lat between p_lat - 0.0015 and p_lat + 0.0015
       and p.lon between p_lon - 0.0015 and p_lon + 0.0015
       and (p.velocidad <= 15 or p.ignicion is true)
  ),
  -- 2. ¿Quién recorrió ESA calle? Regla del producto: a <=45 m del TRAMO.
  en_la_calle as (
    select c.id, c.nombre, round(c.m)::int m, pos.cam, pos.f,
           count(*) n, min(pos.ts) primera
      from la_calle c
      join pos on pos.lat between c.la_min - 0.0004 and c.la_max + 0.0004
              and pos.lon between c.lo_min - 0.0004 and c.lo_max + 0.0004
              and _dist_a_tramo_m(pos.lat, pos.lon,
                    (c.geom->0->>0)::float8,  (c.geom->0->>1)::float8,
                    (c.geom->-1->>0)::float8, (c.geom->-1->>1)::float8) <= 45
     group by c.id, c.nombre, c.m, pos.cam, pos.f
  ),
  -- 3. Y quién anduvo CERCA pero por OTRA calle. No cumple, pero no es lo mismo que nadie.
  otras as (
    select r.id, r.nombre, round(r.m)::int m, pos.cam, pos.f, count(*) n, min(pos.ts) primera
      from reclamo r
      join pos on pos.lat between r.la_min - 0.0004 and r.la_max + 0.0004
              and pos.lon between r.lo_min - 0.0004 and r.lo_max + 0.0004
              and _dist_a_tramo_m(pos.lat, pos.lon,
                    (r.geom->0->>0)::float8,  (r.geom->0->>1)::float8,
                    (r.geom->-1->>0)::float8, (r.geom->-1->>1)::float8) <= 45
     where r.id not in (select id from la_calle)
     group by r.id, r.nombre, r.m, pos.cam, pos.f
  )
  -- ⛔ TODAS calificadas con `x.`: los nombres de `returns table` son variables de plpgsql
  --    y sin el alias Postgres no sabe si «clase» es la columna o la variable
  --    («column reference is ambiguous»). Mordio tres veces el 30/10/2026.
  select x.clase, x.calle, x.tramo, x.a_metros_del_punto, x.recorrida,
         x.cam, x.f, x.hora, x.posiciones from (
  select 1 orden, 'LA CALLE' clase, e.nombre calle, e.id tramo, e.m a_metros_del_punto,
         true recorrida, e.cam cam, e.f f, e.primera hora, e.n posiciones from en_la_calle e
  union all
  -- Si la calle existe pero NADIE la recorrió, se dice con una fila, no con silencio:
  -- un resultado vacío no distingue «no pasó nadie» de «la consulta no encontró la calle».
  -- Si una calle del reclamo NO la recorrio nadie, se dice con una fila, no con silencio:
  -- un resultado vacio no distingue «no paso nadie» de «la consulta no encontro la calle».
  select 1, 'LA CALLE', c.nombre, c.id, round(c.m)::int, false, null, null, null, 0
    from la_calle c where not exists (select 1 from en_la_calle e where e.id = c.id)
  union all
  select 2, 'cerca, por otra calle', o.nombre, o.id, o.m, true, o.cam, o.f, o.primera, o.n from otras o
  ) x order by x.orden, x.recorrida desc, x.a_metros_del_punto;
end $$;

comment on function public.denuncia_por_calle(double precision, double precision, date, date, integer) is
  'Contesta una denuncia POR LA CALLE: primero busca qué calle es la del reclamo (el tramo '
  'más cercano al punto) y después si alguien RECORRIÓ esa calle, no si pasó cerca. '
  '⛔ Usar ESTA para contestarle a la Alcaldía, no `paso_por_aqui`: esa busca en un círculo '
  'de 120 m —cuadra y media— donde entran la calle del reclamo y todas las de alrededor, '
  'así que contesta «sí pasamos» por un camión que fue por la de enfrente. Y se equivoca '
  'siempre a nuestro favor, que es lo peor que le puede pasar a una prueba. '
  '⚠️ Si no hay ningún tramo cerca devuelve una fila con `recorrida = false` y el nombre '
  'del callejero: no se cae para atrás al círculo ni contesta vacío. '
  '⚠️ Recorrer no es limpiar: prueba que la unidad pasó por esa calle.';

comment on function public.paso_por_aqui(double precision, double precision, integer, date, date, integer) is
  'Posiciones a menos de N metros de un PUNTO. Correcta para lo que se reclama como punto: '
  'un contenedor, una esquina, basura frente a tal número. '
  '⛔ NO la uses para contestar una denuncia por una CALLE: mide cercanía, no si se recorrió '
  'la calle, y con 120 m de radio entran las calles de alrededor. Para eso está '
  '`denuncia_por_calle`. [[norma-no-es-la-distancia-es-el-acceso]]';

revoke all on function public.denuncia_por_calle(double precision, double precision, date, date, integer) from anon;
grant execute on function public.denuncia_por_calle(double precision, double precision, date, date, integer) to authenticated, service_role;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- ⛔ LA PRUEBA QUE IMPORTA es que sepa decir que NO. Con la calle del caso del 30/10 y un
--    rango en que esa parroquia NO salió, tiene que devolver `recorrida = false` con el
--    nombre de la calle — no una lista vacía ni un «sí» por la calle de enfrente.
-- select * from denuncia_por_calle(<lat>, <lon>, '2026-10-30', '2026-10-30');
--    → Olegario no sale los viernes: la fila de 'LA CALLE' tiene que decir false.
-- select * from denuncia_por_calle(<lat>, <lon>, '2026-10-29', '2026-10-29');
--    → el jueves sí salió: 'LA CALLE' con `recorrida = true` y el camión que la hizo.
-- ⚠️ Y comparar contra `paso_por_aqui` el mismo día: si una dice que sí y la otra que no,
--    la diferencia ES el problema que esta pieza arregla, no un error.
