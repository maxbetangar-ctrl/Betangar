-- ============================================================================
-- ¿QUÉ UNIDADES SALIERON HOY DE VERDAD? — 2026-10-21.
--
-- Máximo: «ese reporte tiene que estar anclado a que lleguen realmente unidades
-- que salieron a trabajar… si una unidad no salió dice salieron 11 de 12».
--
-- ⛔ EL CHECKLIST NO PRUEBA QUE SALIÓ: prueba que el chofer revisó el camión. Un
--    camión revisado y dejado en el patio tiene checklist igual. La prueba de
--    que salió es que SE MOVIÓ.
--
-- ⛔ ESTO VIVE EN LA BASE Y NO EN LA FUNCIÓN. PostgREST devuelve 1000 filas por
--    consulta y `gps_posiciones` tiene ~600 por unidad POR DÍA: leer las
--    posiciones desde afuera y agrupar en el navegador/función daba
--    «JAC-B001 es la única con equipo GPS» —se había comido a las otras nueve en
--    el tope— y el mensaje salía diciendo que once unidades no tienen GPS.
--    Agrupar es trabajo de la base. [[norma-la-barra-que-no-dice-que-sigue]]
--
-- ⚠️ `gps_posiciones.ts` está en UTC y Venezuela es UTC−4. El día de Venezuela
--    va de `fecha 04:00 UTC` a `fecha+1 04:00 UTC`. Comparar contra la fecha
--    pelada mete medio día ajeno. [[norma-una-medicion-tiene-hora]]
--
-- ⚠️ NO se usa `gps_dia`: se calcula al final del día (hoy, 18:15 VE), así que a
--    las 8:00 de la mañana no sirve para decir quién salió.
--
-- `tiene_equipo` se deduce de si esa unidad reportó ALGO en los últimos 7 días,
-- no de una lista a mano: B011 y B012 no están en la cuenta del proveedor desde
-- agosto, y el día que las conecten esto se entera solo.
-- ============================================================================

create or replace function btg_salidas_del_dia(p_fecha date default null)
returns table (
  cam              text,
  tiene_equipo     boolean,
  primera_salida   text,    -- HH:MM hora de Venezuela, null si no se movió
  posiciones       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) as dia
  ),
  rango as (
    select (dia::timestamp + interval '4 hours') as desde,
           (dia::timestamp + interval '28 hours') as hasta
      from f
  ),
  equipo as (
    select distinct g.cam
      from gps_posiciones g, f
     where g.ts >= (f.dia::timestamp + interval '4 hours') - interval '7 days'
  ),
  movio as (
    select g.cam,
           min(g.ts) filter (where g.velocidad > 5) as primer_mov,
           count(*) as n
      from gps_posiciones g, rango r
     where g.ts >= r.desde and g.ts < r.hasta
     group by g.cam
  )
  select u.cam,
         (e.cam is not null) as tiene_equipo,
         to_char(m.primer_mov - interval '4 hours', 'HH24:MI') as primera_salida,
         coalesce(m.n, 0) as posiciones
    from unidad_config u
    left join equipo e on e.cam = u.cam
    left join movio  m on m.cam = u.cam
   where coalesce(u.activo, true)
   order by u.cam
$$;

comment on function btg_salidas_del_dia is
  'Qué unidades se movieron hoy (prueba de que salieron a trabajar) y cuáles no tienen equipo GPS. El día es el de Venezuela (UTC−4). No usa gps_dia: esa se calcula al cierre del día y a las 8:00 no sirve.';

revoke all on function btg_salidas_del_dia(date) from anon, public;
grant execute on function btg_salidas_del_dia(date) to authenticated, service_role;

-- ── CONTROL POSITIVO ───────────────────────────────────────────────────────
do $$
declare
  n_total   bigint;
  n_equipo  bigint;
  n_salidas bigint;
  v_min     text;
begin
  select count(*), count(*) filter (where tiene_equipo), count(primera_salida), min(primera_salida)
    into n_total, n_equipo, n_salidas, v_min
    from btg_salidas_del_dia(date '2026-10-21');

  if n_total < 12 then
    raise exception 'devolvió % unidades y hay al menos 12 activas', n_total;
  end if;
  -- ⛔ Lo que reventó la primera versión: creer que solo una unidad tiene GPS.
  --    Son 10 (B011 y B012 no están en la cuenta del proveedor desde agosto).
  if n_equipo <> 10 then
    raise exception 'tiene_equipo dio % unidades y las medidas son 10: el agrupamiento está perdiendo filas', n_equipo;
  end if;
  if n_salidas < 10 then
    raise exception 'el 21/10 se movieron 10 unidades y esto cuenta %', n_salidas;
  end if;
  -- Y que la hora sea de VENEZUELA, no UTC: el primer movimiento fue 05:51 VE.
  if v_min is null or v_min > '09:00' then
    raise exception 'la primera salida dio % — eso es hora UTC, no de Venezuela', v_min;
  end if;
  if has_function_privilege('anon', 'btg_salidas_del_dia(date)', 'execute') then
    raise exception 'anon puede ejecutarla: el recorrido de la flota no es público';
  end if;

  raise notice 'OK · % unidades, % con equipo, % salieron, primera %', n_total, n_equipo, n_salidas, v_min;
end $$;
