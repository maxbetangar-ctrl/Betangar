-- BETANGAR — El control de las calles fijas: CALLE POR CALLE, no por radio
-- Fecha: 2026-10-30 (reemplaza el control por radio del mismo día)
--
-- ⛔ POR QUÉ SE CAMBIA, Y ES UN DEFECTO DE LO QUE SE ESCRIBIÓ HOY. Máximo: «no es solo la
--    distancia sino cómo llegar a esa calle».
--    El control anterior preguntaba «¿hubo alguna unidad a menos de 50 m del punto?». Con
--    el punto en la casa y la T ciega a 49-54 m, **un camión que pasa por la calle de
--    enfrente contaba como que pasó, sin haber entrado nunca a la T**. Y la T es
--    justamente la que se queda sin limpiar: no se pasa por ahí de camino a ningún lado,
--    hay que entrar a propósito y salir maniobrando.
--    ⇒ Un radio mide cercanía. Lo que hay que medir es si RECORRIÓ CADA CALLE.
--
-- 📏 MEDIDO el jueves 29/10 (último día de Olegario, que sale lunes y jueves): B006 SÍ
--    entró a los 4 tramos —23, 13, 5 y 13 posiciones—, y tres de los cuatro los tocó
--    **solo él**. O sea que la T estaba limpia y el dueño declarado es el correcto.
--    ⚠️ Pero eso recién se pudo ver con el control calle por calle. Con el radio, los
--    cuatro casos daban lo mismo: «pasó».
--
-- 🧭 Y EL ACCESO, que es lo que preguntó. Leído del GPS de ese día, no deducido de un
--    mapa: B006 entra desde el SUROESTE subiendo al NORESTE (rumbos 25°-42°), llega a la
--    cuadra a las 08:21, sale, y VUELVE a las 08:41-08:48 con rumbos que saltan de 89° a
--    211° a 282° —entrar, girar y salir maniobrando—. Lo hace en DOS PASADAS: primero la
--    calle de la casa, después las interiores. Eso es lo que va en la hoja del chofer.
--
-- ⛔ Lo que sigue sin poder afirmarse: pasar por la calle NO es haberla limpiado. El GPS
--    prueba que la unidad la recorrió. Se dice así, no se infla.

begin;

create or replace function public.calles_fijas_del_dia(p_fecha date default null)
returns table (
  tramo bigint, nombre text, metros integer, parroquia text,
  cam_exigido text, le_tocaba boolean, recorrida boolean,
  quien text, posiciones bigint, desde timestamptz, hasta timestamptz
)
language sql stable security definer set search_path = public as $$
  with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
  toca as (
    select distinct c.parroquia from f, cronograma_del_dia(f.d) c where c.parroquia is not null
  ),
  t as (
    select zc.id, coalesce(zc.nombre, '(sin nombre en el callejero)') nombre,
           round(zc.metros)::int metros, zc.parroquia, zc.fijo_cam, zc.geom,
           zc.la_min, zc.la_max, zc.lo_min, zc.lo_max
      from zona_calles zc where zc.fijo_cam is not null
  ),
  paso as (
    -- La regla del producto, la misma de `zona_cobertura_del_dia`: a <=45 m del tramo,
    -- con el camion trabajando. Asi los numeros son comparables con los que ya existen.
    select t.id, p.cam, count(*) n, min(p.ts) desde, max(p.ts) hasta
      from t
      cross join f
      join gps_posiciones p
        on p.ts >= (f.d::timestamp at time zone 'America/Caracas')
       and p.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
       and p.lat between t.la_min - 0.0004 and t.la_max + 0.0004
       and p.lon between t.lo_min - 0.0004 and t.lo_max + 0.0004
       and (p.velocidad <= 15 or p.ignicion is true)
       and _dist_a_tramo_m(p.lat, p.lon,
             (t.geom->0->>0)::float8,  (t.geom->0->>1)::float8,
             (t.geom->-1->>0)::float8, (t.geom->-1->>1)::float8) <= 45
     group by t.id, p.cam
  ),
  -- ⛔ Primero se busca al EXIGIDO. Que haya pasado otro no cumple: la calle tiene dueño
  --    declarado justamente para que no dependa de quien ande cerca.
  suyo as (
    select p.* from paso p join t on t.id = p.id and t.fijo_cam = p.cam
  ),
  ajeno as (
    select p.id, p.cam, p.n, p.desde, p.hasta,
           row_number() over (partition by p.id order by p.n desc) rn
      from paso p join t on t.id = p.id and t.fijo_cam <> p.cam
  )
  select t.id, t.nombre, t.metros, t.parroquia, t.fijo_cam,
         (t.parroquia in (select parroquia from toca)),
         (s.id is not null),
         coalesce(s.cam, a.cam), coalesce(s.n, a.n, 0), coalesce(s.desde, a.desde), coalesce(s.hasta, a.hasta)
    from t
    left join suyo s on s.id = t.id
    left join ajeno a on a.id = t.id and a.rn = 1
   order by (t.parroquia in (select parroquia from toca)) desc, (s.id is null) desc, t.metros desc
$$;

comment on function public.calles_fijas_del_dia(date) is
  'Calle por calle de las que tienen dueño declarado (`zona_calles.fijo_cam`): si ese día le '
  'tocaba su parroquia y si el camión EXIGIDO la recorrió. '
  '⛔ Reemplaza al control por radio, que no distinguía entrar a una calle sin salida de '
  'pasar por la de enfrente: con el punto en la casa y la T a 50 m, las dos daban «pasó». '
  '⚠️ `quien` puede traer OTRO camión: eso no cumple —la calle tiene dueño justamente para '
  'que no dependa de quién ande cerca— pero se muestra, porque «la hizo otro» y «no la hizo '
  'nadie» son cosas distintas y hay que poder distinguirlas. '
  '⚠️ Y recorrer no es limpiar: el GPS prueba que la unidad pasó por ahí.';

revoke all on function public.calles_fijas_del_dia(date) from anon;
grant execute on function public.calles_fijas_del_dia(date) to authenticated, service_role;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select * from calles_fijas_del_dia('2026-10-29');   -- jueves: Olegario SI salio
--   → los 4 tramos con `le_tocaba = true` y `recorrida = true`, `quien = JAC-B006`.
-- select * from calles_fijas_del_dia();               -- viernes: Olegario NO sale
--   → `le_tocaba = false`. Eso NO es una falta y el aviso no tiene que hablar.
-- ⛔ CONTROL POSITIVO AL REVES, que es el que falta y hay que hacer a mano: tomar un dia
--    en que la parroquia SI salio y el camion NO entro a la T, y comprobar que
--    `recorrida = false`. Si nunca se vio decir que no, no se sabe si sabe decirlo.
