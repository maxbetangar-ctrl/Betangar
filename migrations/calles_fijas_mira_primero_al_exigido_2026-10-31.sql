-- ════════════════════════════════════════════════════════════════════════════
--  LA PREGUNTA ES POR UN CAMIÓN: QUE LA CONSULTA EMPIECE POR ÉL.
--
--  LO QUE PASÓ (31/10/2026). Con el índice BRIN por fecha, `calles_fijas_del_dia`
--  baja a 1,3 s en caliente. Pero medido POR POSTGREST, que es como la llama el
--  vigilante: **8,4 s la primera vez (frío) y 3,2 s la segunda**. PostgREST corta
--  a los 8 s, así que la primera del día —justo la que importa, porque el cron
--  corre dos veces y siempre llega en frío— se pasaba y devolvía vacío.
--
--  LA CAUSA NO ERA EL CÁLCULO SINO LA LECTURA: para saber si pasó UN camión, la
--  consulta traía las ~6.500 posiciones del día DE LOS DOCE y recién después
--  filtraba. En frío eso son miles de páginas de disco.
--
--  ⇒ `suyo` ahora filtra por `p.cam = t.fijo_cam` DENTRO del join, así el
--    planificador puede usar `(cam, ts)` —el índice único que ya existía— y lee
--    ~550 filas en vez de 6.500. El camino caro queda sólo para `ajeno`, que es
--    el dato de contexto («pasó otro») y sólo hace falta cuando el exigido NO
--    pasó, que es la excepción.
--
--  ⛔ LA REGLA DE PRODUCTO NO CAMBIA: que haya pasado otro camión NO cumple. El
--     tramo tiene dueño declarado justamente para que no dependa de quién ande
--     cerca. Esto es sólo cómo se lee, no qué se exige.
--
--  📌 Y NO SE TOCA LA DISTANCIA NI EL FILTRO DE TRABAJO: los mismos 45 m y el
--     mismo «lento o con motor encendido» de `zona_cobertura_del_dia`, para que
--     los números sigan siendo comparables entre las dos piezas.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function calles_fijas_del_dia(p_fecha date default null)
returns table (
  tramo bigint, nombre text, metros integer, parroquia text,
  cam_exigido text, le_tocaba boolean, recorrida boolean,
  quien text, posiciones bigint, desde timestamptz, hasta timestamptz,
  referencia text
)
language sql stable security definer set search_path = public as $$
  with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
  toca as (
    select distinct c.parroquia from f, cronograma_del_dia(f.d) c where c.parroquia is not null
  ),
  t as (
    select zc.id, coalesce(zc.nombre, '(sin nombre en el callejero)') nombre,
           round(zc.metros)::int metros, zc.parroquia, zc.fijo_cam, zc.geom,
           zc.la_min, zc.la_max, zc.lo_min, zc.lo_max, zc.fijo_referencia
      from zona_calles zc where zc.fijo_cam is not null
  ),
  -- ⛔ EMPIEZA POR EL CAMIÓN EXIGIDO. `p.cam = t.fijo_cam` en el join deja que el
  --    planificador use `(cam, ts)`: ~550 filas en vez de las ~6.500 del día.
  suyo as (
    select t.id, p.cam, count(*) n, min(p.ts) desde, max(p.ts) hasta
      from t
      cross join f
      join gps_posiciones p
        on p.cam = t.fijo_cam
       and p.ts >= (f.d::timestamp at time zone 'America/Caracas')
       and p.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
       and p.lat between t.la_min - 0.0004 and t.la_max + 0.0004
       and p.lon between t.lo_min - 0.0004 and t.lo_max + 0.0004
       and (p.velocidad <= 15 or p.ignicion is true)
       and _dist_a_tramo_m(p.lat, p.lon,
             (t.geom->0->>0)::float8,  (t.geom->0->>1)::float8,
             (t.geom->-1->>0)::float8, (t.geom->-1->>1)::float8) <= 45
     group by t.id, p.cam
  ),
  -- El camino caro, sólo para los tramos que su dueño NO recorrió. Es contexto
  -- («pasó otro»), no cumplimiento.
  -- ⛔ Y SÓLO SI LA PARROQUIA SALIÓ ESE DÍA. Medido: sin esta condición, un día en
  --    que la parroquia no toca —o sea casi todos— `suyo` queda vacío para los
  --    cuatro tramos y se dispara igual el recorrido de las 6.500 posiciones de la
  --    flota entera, para contestar algo que a nadie le sirve: «pasó otro camión
  --    por una calle que hoy no le tocaba a nadie». Con el filtro, esos días no se
  --    toca `gps_posiciones` más que por el camino barato. 7,5 s en frío → ver la
  --    comprobación del final.
  ajeno as (
    select q.id, q.cam, q.n, q.desde, q.hasta,
           row_number() over (partition by q.id order by q.n desc) rn
      from (
        select t.id, p.cam, count(*) n, min(p.ts) desde, max(p.ts) hasta
          from t
          cross join f
          join gps_posiciones p
            on p.cam <> t.fijo_cam
           and p.ts >= (f.d::timestamp at time zone 'America/Caracas')
           and p.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
           and p.lat between t.la_min - 0.0004 and t.la_max + 0.0004
           and p.lon between t.lo_min - 0.0004 and t.lo_max + 0.0004
           and (p.velocidad <= 15 or p.ignicion is true)
           and _dist_a_tramo_m(p.lat, p.lon,
                 (t.geom->0->>0)::float8,  (t.geom->0->>1)::float8,
                 (t.geom->-1->>0)::float8, (t.geom->-1->>1)::float8) <= 45
         where not exists (select 1 from suyo s where s.id = t.id)
           and t.parroquia in (select parroquia from toca)
         group by t.id, p.cam) q
  )
  select t.id, t.nombre, t.metros, t.parroquia, t.fijo_cam,
         (t.parroquia in (select parroquia from toca)),
         (s.id is not null),
         coalesce(s.cam, a.cam), coalesce(s.n, a.n, 0),
         coalesce(s.desde, a.desde), coalesce(s.hasta, a.hasta),
         t.fijo_referencia
    from t
    left join suyo s on s.id = t.id
    left join ajeno a on a.id = t.id and a.rn = 1
   order by (t.parroquia in (select parroquia from toca)) desc, (s.id is null) desc, t.metros desc
$$;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- ⛔ CONTROL POSITIVO CONTRA UN DÍA CONOCIDO. El 26/10 (día de Olegario) las
--    cuatro calles vigiladas quedaron recorridas por B006. Si esta reescritura
--    cambiara ese resultado, estaría arreglando la velocidad y rompiendo el dato.
do $v$
declare v_tocaba int; v_hechas int; v_ms numeric; v_t timestamptz;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select count(*) filter (where le_tocaba), count(*) filter (where le_tocaba and recorrida)
    into v_tocaba, v_hechas from calles_fijas_del_dia('2026-10-26');
  if v_tocaba <> 4 or v_hechas <> 4 then
    raise exception 'REGRESION: el 26/10 le tocaban 4 y se hicieron 4; ahora da % y %',
      v_tocaba, v_hechas;
  end if;

  -- Y que siga devolviendo los 4 tramos con su referencia.
  if (select count(*) from calles_fijas_del_dia(current_date) where referencia is not null) <> 4 then
    raise exception 'no devuelve los 4 tramos con referencia';
  end if;

  v_t := clock_timestamp();
  perform count(*) from calles_fijas_del_dia(current_date);
  v_ms := extract(milliseconds from (clock_timestamp() - v_t))
        + 1000 * extract(seconds from (clock_timestamp() - v_t));
  raise notice 'OK · 26/10 sigue dando 4 de 4 · hoy tarda % ms', round(v_ms);
end $v$;
