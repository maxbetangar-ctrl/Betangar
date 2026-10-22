-- ════════════════════════════════════════════════════════════════════════════
--  paso_por_poligono / dias_por_poligono — ¿qué días entró un camión en ESTA
--  zona dibujada?
--  Pedido por Máximo el 22/10/2026: «que pueda dibujar un polígono».
--
--  ⛔ POR QUÉ HACÍA FALTA, teniendo ya el círculo. La denuncia del 21/10 venía
--     con una zona dibujada a mano sobre un plano: varias manzanas entre la
--     Avenida 3F y la Calle 72. Un círculo sobre esa zona **sobra por un lado y
--     falta por el otro**: o se mete calles que nadie reclamó, o deja afuera
--     parte de lo reclamado. Contra una denuncia hay que poder contestar sobre
--     la MISMA forma que señalaron, no sobre una aproximación nuestra.
--
--  ⛔ LA PRUEBA ES LA CORRECTA Y NO LA FÁCIL. Lo fácil es preguntar si alguna
--     POSICIÓN cayó dentro del polígono. Eso daría muchos falsos «no pasó»:
--     entre un reporte y el siguiente el camión recorre **265 m de mediana** y
--     hasta 928 m (p90), o sea que **puede cruzar la zona entera sin dejar un
--     solo punto adentro**. Acá se pregunta si el TRAMO entre dos posiciones
--     consecutivas **entra o atraviesa** el polígono: cualquiera de las dos
--     puntas adentro, o el tramo cortando algún lado.
--
--  ⛔ Y SE MANTIENE LA REGLA QUE EVITA FABRICAR PRUEBA: un tramo con más de
--     `p_minutos_tramo` (5) entre una posición y la otra NO cuenta. El equipo se
--     calla hasta 57 min con el motor encendido; decir que cruzó una zona porque
--     la recta entre los dos extremos del silencio la atraviesa sería inventar
--     un recorrido que nadie midió. [[norma-respaldo-que-inventa-un-dato]]
--
--  FORMATO DEL POLÍGONO: jsonb `[[lat,lon],[lat,lon],…]`, el mismo que ya usa
--  `sitios_asistencia.poligono` y el que arma el mapa al tocar las esquinas. Una
--  sola forma de escribir un polígono en toda la casa.
-- ════════════════════════════════════════════════════════════════════════════

-- ¿El punto cae dentro? Lanzamiento de rayo, en grados (la deformación no
-- cambia de qué lado de un borde cae un punto).
create or replace function _punto_en_poligono(
  p_lat double precision, p_lon double precision, p_poli jsonb
) returns boolean
language plpgsql immutable as $$
declare n int; i int; j int; xi double precision; yi double precision;
        xj double precision; yj double precision; dentro boolean := false;
begin
  n := jsonb_array_length(p_poli);
  if n is null or n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_poli -> i ->> 0)::double precision;  -- lat
    xi := (p_poli -> i ->> 1)::double precision;  -- lon
    yj := (p_poli -> j ->> 0)::double precision;
    xj := (p_poli -> j ->> 1)::double precision;
    if ((yi > p_lat) <> (yj > p_lat))
       and (p_lon < (xj - xi) * (p_lat - yi) / nullif(yj - yi, 0) + xi) then
      dentro := not dentro;
    end if;
    j := i;
  end loop;
  return dentro;
end $$;

-- ¿Se cruzan dos segmentos? Por orientación. Sirve para saber si el tramo del
-- camión corta un lado del polígono aunque ninguna punta caiga adentro.
create or replace function _cruzan(
  ax double precision, ay double precision, bx double precision, by double precision,
  cx double precision, cy double precision, dx double precision, dy double precision
) returns boolean
language sql immutable as $$
  with o as (
    select sign((bx-ax)*(cy-ay) - (by-ay)*(cx-ax)) o1,
           sign((bx-ax)*(dy-ay) - (by-ay)*(dx-ax)) o2,
           sign((dx-cx)*(ay-cy) - (dy-cy)*(ax-cx)) o3,
           sign((dx-cx)*(by-cy) - (dy-cy)*(bx-cx)) o4
  )
  select (o1 <> o2 and o3 <> o4) from o
$$;

create or replace function _tramo_toca_poligono(
  a_lat double precision, a_lon double precision,
  b_lat double precision, b_lon double precision, p_poli jsonb
) returns boolean
language plpgsql immutable as $$
declare n int; i int; j int; yi double precision; xi double precision;
        yj double precision; xj double precision;
begin
  -- Una punta adentro alcanza.
  if _punto_en_poligono(a_lat, a_lon, p_poli) then return true; end if;
  if _punto_en_poligono(b_lat, b_lon, p_poli) then return true; end if;
  n := jsonb_array_length(p_poli);
  if n is null or n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_poli -> i ->> 0)::double precision; xi := (p_poli -> i ->> 1)::double precision;
    yj := (p_poli -> j ->> 0)::double precision; xj := (p_poli -> j ->> 1)::double precision;
    -- Atravesó sin dejar una punta adentro: cruza un lado.
    if coalesce(_cruzan(a_lon, a_lat, b_lon, b_lat, xi, yi, xj, yj), false) then
      return true;
    end if;
    j := i;
  end loop;
  return false;
end $$;

-- ── Las pasadas por la zona dibujada ────────────────────────────────────────
create or replace function paso_por_poligono(
  p_poli jsonb, p_desde date default null, p_hasta date default null,
  p_minutos_tramo integer default 5
) returns table (f date, cam text, hora timestamptz, por text, min_del_tramo numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_desde date := p_desde; v_hasta date := p_hasta; v_n int;
begin
  perform gps_ve_o_falla();
  v_n := jsonb_array_length(p_poli);
  if v_n is null or v_n < 3 then
    -- ⛔ Se dice. Un polígono de dos esquinas devolvería CERO días y eso se leería
    -- como «nunca pasamos», que es lo contrario de lo que hay que contestar.
    raise exception 'La zona necesita al menos 3 esquinas (llegaron %)', coalesce(v_n, 0);
  end if;

  return query
  with par as (
    select p.cam cc, p.ts, p.lat, p.lon,
           lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0
      from gps_posiciones p
     where (v_desde is null or (p.ts at time zone 'America/Caracas')::date >= v_desde)
       and (v_hasta is null or (p.ts at time zone 'America/Caracas')::date <= v_hasta)
    window w as (partition by p.cam order by p.ts)
  ), medido as (
    select (ts at time zone 'America/Caracas')::date ff, cc, ts,
           extract(epoch from (ts - t0))/60.0 mins,
           case when la is null then _punto_en_poligono(lat, lon, p_poli)
                else _tramo_toca_poligono(la, lo, lat, lon, p_poli) end toca,
           (la is not null) hay_tramo
      from par
  )
  select ff, cc, ts,
         case when not hay_tramo then 'punto'
              when mins <= p_minutos_tramo then 'tramo'
              else 'tramo largo (no cuenta)' end,
         round(mins::numeric, 1)
    from medido
   where toca
   order by ff desc, ts;
end $$;

create or replace function dias_por_poligono(
  p_poli jsonb, p_desde date default null, p_hasta date default null
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
    select * from paso_por_poligono(p_poli, v_desde, v_hasta)
     where por <> 'tramo largo (no cuenta)'
  ), huecos as (
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
         -- Dentro de la zona la distancia no tiene sentido: entró o no entró.
         null::int,
         coalesce(h.hueco, 0)
    from dias d
    left join (
      select pp.f ff, count(*) n, min(pp.hora) pri, max(pp.hora) ult,
             string_agg(distinct pp.cam, ', ' order by pp.cam) unis
        from pas pp group by pp.f
    ) p on p.ff = d.ff
    left join huecos h on h.ff = d.ff
   order by d.ff desc;
end $$;

revoke all on function paso_por_poligono(jsonb,date,date,integer) from anon;
revoke all on function dias_por_poligono(jsonb,date,date) from anon;

-- ── CONTROL POSITIVO Y NEGATIVO ─────────────────────────────────────────────
do $$
declare uid text; lat double precision; lon double precision;
        cerca jsonb; lejos jsonb; n int; n_lejos int; nego boolean := false;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  select p.lat, p.lon into lat, lon from gps_posiciones p
   where p.ignicion and p.velocidad > 10 order by p.ts desc limit 1;
  if lat is null then raise exception 'CONTROL: no hay posiciones para probar'; end if;

  -- Un cuadrado de ~200 m ALREDEDOR de una posición real: tiene que encontrarla.
  cerca := jsonb_build_array(
    jsonb_build_array(lat-0.001, lon-0.001), jsonb_build_array(lat-0.001, lon+0.001),
    jsonb_build_array(lat+0.001, lon+0.001), jsonb_build_array(lat+0.001, lon-0.001));
  select count(*) into n from paso_por_poligono(cerca, current_date - 3, current_date);
  if n = 0 then
    raise exception 'CONTROL POSITIVO FALLÓ: un cuadrado alrededor de una posición real dio CERO.';
  end if;

  -- El mismo cuadrado a ~40 km: no puede encontrar nada.
  lejos := jsonb_build_array(
    jsonb_build_array(lat+0.359, lon-0.001), jsonb_build_array(lat+0.359, lon+0.001),
    jsonb_build_array(lat+0.361, lon+0.001), jsonb_build_array(lat+0.361, lon-0.001));
  select count(*) into n_lejos from paso_por_poligono(lejos, current_date - 3, current_date);
  if n_lejos > 0 then
    raise exception 'CONTROL NEGATIVO FALLÓ: una zona a 40 km dio % pasadas', n_lejos;
  end if;

  -- El punto del centro tiene que estar adentro, y uno de afuera, afuera.
  if not _punto_en_poligono(lat, lon, cerca) then
    raise exception 'CONTROL: el centro del cuadrado no da como adentro';
  end if;
  if _punto_en_poligono(lat + 0.01, lon, cerca) then
    raise exception 'CONTROL: un punto claramente afuera da como adentro';
  end if;

  -- ⛔ Y LO QUE DISTINGUE ESTA PIEZA DE LA FÁCIL: un tramo que ATRAVIESA la zona
  -- sin dejar ninguna punta adentro tiene que contar. Si esto falla, la función
  -- daría «no pasó» justo cuando el camión cruzó sin reportar en el medio.
  if not _tramo_toca_poligono(lat, lon-0.01, lat, lon+0.01, cerca) then
    raise exception 'CONTROL: un tramo que atraviesa la zona de lado a lado NO se detectó';
  end if;

  -- Una zona de 2 esquinas tiene que negarse, no devolver vacío.
  begin
    perform count(*) from paso_por_poligono(
      jsonb_build_array(jsonb_build_array(lat,lon), jsonb_build_array(lat+0.001,lon)),
      current_date - 3, current_date);
  exception when others then
    if position('al menos 3 esquinas' in sqlerrm) > 0 then nego := true; else raise; end if;
  end;
  if not nego then raise exception 'CONTROL: una zona de 2 esquinas no se rechazó'; end if;

  raise notice 'OK · encuentra (% pasadas), no encuentra lo lejano, detecta el cruce '
    'sin puntas adentro, y rechaza una zona de 2 esquinas', n;
end $$;
