-- ════════════════════════════════════════════════════════════════════════════
--  El candado de las consultas del GPS — y UNA SOLA lista de roles.
--  Escrito el 22/10/2026, al poner el botón «¿Pasamos por aquí?» en el mapa.
--
--  ⛔ EL AGUJERO QUE CIERRA, y lo abrí yo anoche. `paso_por_aqui` y
--     `dias_por_aqui` nacieron `security definer` con `revoke ... from anon`, y
--     eso NO alcanza: `security definer` **se salta la RLS**, así que cualquier
--     usuario con sesión —incluido uno con un rol que la RLS de `gps_posiciones`
--     NO deja leer el GPS, como `compras`— podía pedir el recorrido de la flota
--     llamando a la función. El `revoke` solo tapaba a `anon`.
--     [[norma-no-estar-en-la-lista-no-es-candado]]
--
--  ⛔ Y SE PONE EN UNA SOLA FUNCIÓN, NO COPIADA EN CADA UNA. La lista de roles ya
--     vive en tres lugares (la RLS de `gps_posiciones`, `chofer_del_dia` y
--     `ROLES_MAPA` en `mapa.html`). Copiarla una cuarta y una quinta vez es como
--     se fabrica el día en que una deja pasar lo que otra niega.
--     [[norma-dos-listas-a-mano-se-desincronizan]]
-- ════════════════════════════════════════════════════════════════════════════

create or replace function gps_ve_o_falla() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  -- ⛔ El `is null` va EXPLÍCITO: `null = any(array)` da NULL, `not NULL` da NULL,
  -- y un `if` con condición nula NO dispara. Sin esta línea el candado deja
  -- pasar justo a quien no tiene rol. Ya mordió ayer en `chofer_del_dia`.
  if app_rol() is null
     or not (app_rol() = any (array['superadmin','admin','operador','visualizador',
          'directivo','auditor','revisor','operativo','mecanico','rrhh'])) then
    raise exception 'Tu usuario no tiene permiso para consultar el recorrido de la flota';
  end if;
  return true;
end $$;

comment on function gps_ve_o_falla() is
  'Quién puede consultar el recorrido del GPS. Única copia de la lista para las funciones '
  'que leen posiciones con `security definer` (que se saltan la RLS). Revienta si no.';

-- ── Se le pone el candado a las dos ─────────────────────────────────────────
-- `paso_por_aqui` era `language sql`; pasa a plpgsql solo para poder negarse.
create or replace function paso_por_aqui(
  p_lat double precision, p_lon double precision,
  p_radio_m integer default 120, p_desde date default null,
  p_hasta date default null, p_minutos_tramo integer default 5
) returns table (
  f date, cam text, hora timestamptz, dist_m integer,
  por text, velocidad numeric, min_del_tramo numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_desde date := p_desde; v_hasta date := p_hasta;
begin
  perform gps_ve_o_falla();
  return query
  with par as (
    select p.cam, p.ts, p.lat, p.lon, p.velocidad,
           lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0
      from gps_posiciones p
     where (v_desde is null or (p.ts at time zone 'America/Caracas')::date >= v_desde)
       and (v_hasta is null or (p.ts at time zone 'America/Caracas')::date <= v_hasta)
    window w as (partition by p.cam order by p.ts)
  ), medido as (
    select (ts at time zone 'America/Caracas')::date ff, par.cam cc, ts, par.velocidad vv,
           extract(epoch from (ts - t0))/60.0 mins,
           case when la is null then _dist_a_tramo_m(p_lat,p_lon,lat,lon,lat,lon)
                else _dist_a_tramo_m(p_lat,p_lon,la,lo,lat,lon) end d,
           (la is not null) hay_tramo
      from par
  )
  select ff, cc, ts, round(d)::int,
         case when not hay_tramo then 'punto'
              when mins <= p_minutos_tramo then 'tramo'
              else 'tramo largo (no cuenta)' end,
         vv, round(mins::numeric, 1)
    from medido
   where d <= p_radio_m
   order by ff desc, ts;
end $$;

create or replace function dias_por_aqui(
  p_lat double precision, p_lon double precision,
  p_radio_m integer default 120, p_desde date default null, p_hasta date default null
) returns table (
  f date, estado text, unidades text, pasadas integer,
  primera text, ultima text, dist_min_m integer, hueco_max_min integer
)
language plpgsql stable security definer set search_path = public as $$
declare v_desde date := p_desde; v_hasta date := p_hasta;
begin
  perform gps_ve_o_falla();
  return query
  with dias as (
    select distinct (ts at time zone 'America/Caracas')::date ff
      from gps_posiciones
     where (v_desde is null or (ts at time zone 'America/Caracas')::date >= v_desde)
       and (v_hasta is null or (ts at time zone 'America/Caracas')::date <= v_hasta)
  ), pas as (
    select * from paso_por_aqui(p_lat, p_lon, p_radio_m, v_desde, v_hasta)
     where por <> 'tramo largo (no cuenta)'
  ), huecos as (
    -- Partido por cam Y POR DÍA: sin lo segundo mide el hueco de la noche.
    select ff, max(mins)::int hueco from (
      select (ts at time zone 'America/Caracas')::date ff,
             extract(epoch from (ts - lag(ts) over (
               partition by cam, (ts at time zone 'America/Caracas')::date order by ts)))/60.0 mins
        from gps_posiciones
       where ignicion
         and (v_desde is null or (ts at time zone 'America/Caracas')::date >= v_desde)
         and (v_hasta is null or (ts at time zone 'America/Caracas')::date <= v_hasta)
    ) x where mins is not null group by ff
  )
  select d.ff,
         case when p.n > 0 then 'pasó'
              when coalesce(h.hueco, 0) >= 20 then 'no se puede afirmar'
              else 'NO pasó' end,
         coalesce(p.unis, '—'), coalesce(p.n, 0)::int,
         to_char(p.pri at time zone 'America/Caracas', 'HH24:MI'),
         to_char(p.ult at time zone 'America/Caracas', 'HH24:MI'),
         p.dmin::int, coalesce(h.hueco, 0)
    from dias d
    left join (
      select paso_por_aqui.f ff, count(*) n, min(hora) pri, max(hora) ult,
             min(dist_m) dmin, string_agg(distinct cam, ', ' order by cam) unis
        from pas paso_por_aqui group by paso_por_aqui.f
    ) p on p.ff = d.ff
    left join huecos h on h.ff = d.ff
   order by d.ff desc;
end $$;

revoke all on function gps_ve_o_falla() from anon;
revoke all on function paso_por_aqui(double precision,double precision,integer,date,date,integer) from anon;
revoke all on function dias_por_aqui(double precision,double precision,integer,date,date) from anon;

-- ── CONTROL POSITIVO Y NEGATIVO ─────────────────────────────────────────────
do $$
declare uid text; lat double precision; lon double precision; n int; nego boolean := false;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  if uid is null then raise exception 'CONTROL: no hay admin para probar el candado'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- CON rol: tiene que seguir contestando lo mismo que antes del candado.
  select p.lat, p.lon into lat, lon from gps_posiciones p
   where p.ignicion and p.velocidad > 10 order by p.ts desc limit 1;
  select count(*) into n from paso_por_aqui(lat, lon, 120, current_date - 3, current_date);
  if n = 0 then
    raise exception 'CONTROL: con rol válido, un punto por donde el camión pasó dio CERO. '
      'El candado rompió la consulta.';
  end if;
  if (select count(*) from dias_por_aqui(lat, lon, 120, current_date - 3, current_date)) = 0 then
    raise exception 'CONTROL: dias_por_aqui no devolvió filas con rol válido';
  end if;

  -- SIN rol: tiene que negarse. Sin esta mitad no se sabe si el candado cierra.
  perform set_config('request.jwt.claims',
            json_build_object('sub','00000000-0000-0000-0000-000000000000')::text, true);
  begin
    perform count(*) from paso_por_aqui(lat, lon, 120, current_date - 3, current_date);
  exception when others then
    if position('no tiene permiso' in sqlerrm) > 0 then nego := true; else raise; end if;
  end;
  if not nego then
    raise exception 'CONTROL: un usuario SIN rol pudo pedir el recorrido de la flota';
  end if;

  raise notice 'OK · con rol contesta (% filas), sin rol se niega', n;
end $$;
