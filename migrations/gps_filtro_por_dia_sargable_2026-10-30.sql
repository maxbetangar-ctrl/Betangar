-- BETANGAR — GPS: que el filtro por DIA vuelva a usar el indice (predicado sargable)
-- Fecha: 2026-10-30
--
-- ⛔ QUE PASABA. Nueve funciones filtraban el dia asi:
--       where (ts at time zone 'America/Caracas')::date = la_fecha
--    Eso aplica una funcion SOBRE la columna, y un indice no se puede usar sobre el
--    resultado de una funcion: `gps_posiciones_cam_ts_uq (cam, ts)` quedaba afuera y
--    Postgres recorria el indice entero descartando casi todo por filtro.
--
-- 📏 MEDIDO el 30/10/2026 contra produccion (319.391 filas, 97 MB), no estimado:
--    · un dia:    233 ms  ->  23 ms   (156.262 filas descartadas por filtro, antes)
--    · 7 dias:    813 ms  ->  51 ms   (138.016 descartadas)
--    · `paso_por_aqui` 7 dias, como la usa un auditor:  16.440 ms
--    · `dias_por_aqui` 7 dias:                          13.252 ms
--    · `dias_por_aqui` SIN fechas:          cortaba por tiempo de conexion
--    Los numeros de despues quedan en la bitacora del dia.
--
-- ⚠️ POR QUE IMPORTA Y NO ES "ir mas rapido": las dos funciones mas lentas son
--    `paso_por_aqui` y `paso_por_poligono`, las que se usan DELANTE DE UN TERCERO para
--    contestar una denuncia de la Alcaldia. Y `zona_cobertura_del_dia` es la pantalla
--    con la que se le habla al chofer. Ademas el costo crece lineal con la tabla, que
--    suma ~1,2 millones de filas al año.
--
-- ✅ EQUIVALENCIA, comprobada antes de tocar nada:
--    `(ts at time zone 'America/Caracas')::date = D`  es exactamente
--    `ts >= D::timestamp at time zone 'America/Caracas' and ts < (D+1)::timestamp ...`
--    Se comparo dia por dia sobre 31 dias: 166.549 filas por los dos caminos, 0
--    diferencias. Y el rango de 7 dias: 43.407 por los dos. Ojo con el borde: la cota
--    de arriba es ESTRICTA (`<` del dia siguiente), porque `::date <= hasta` incluye el
--    dia `hasta` entero. Venezuela no tiene horario de verano, asi que el instante de
--    medianoche no se parte.
--
-- ⛔ LO QUE NO SE TOCA: las mismas palabras aparecen en la lista del SELECT y en algun
--    `partition by` (p. ej. `select (ts at time zone ...)::date ff`). Ahi NO filtran:
--    calculan la fecha de negocio del dato, y cambiarlas si cambiaria el resultado.
--    El cambio son 17 predicados en 9 funciones y nada mas.
--
-- ⛔ TAMPOCO SE AGREGA NINGUN INDICE. Se midio: las consultas que filtran por `ts` y
--    hacen join con `gps_equipos` ya usan el indice (el join aporta el `cam`, 3,2 ms).
--    La tabla son 97 MB; un indice mas es peso muerto sin una consulta que lo pida.
--
-- Las 9 definiciones de abajo se sacaron de la BASE con pg_get_functiondef, no del repo
-- —el repo ya demostro estar atrasado— y solo se les cambio el predicado.

begin;
-- ═══ zona_cobertura_del_dia ════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.zona_cobertura_del_dia(p_fecha date DEFAULT NULL::date)
 RETURNS TABLE(parroquia text, zona smallint, cam text, asignada_desde date, posiciones_del_cam integer, zona_calle_id bigint, nombre text, tramo text, metros integer, orden smallint, geom jsonb, hecho boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
asig as (
  select a.parroquia, a.zona, a.cam, a.desde
    from zona_asignacion a, f
   where a.desde <= f.d and (a.hasta is null or a.hasta >= f.d)),
pos as (
  select g.cam, g.lat, g.lon
    from gps_posiciones g, f
   where g.ts >= (f.d::timestamp at time zone 'America/Caracas')
     and g.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
     and g.velocidad <= 15 and g.ignicion is not false),
cuantas as (
  select cam, count(*)::int n from pos group by 1),
tocado as (
  select distinct zc.id
    from zona_calles zc
    join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
    join pos p  on p.cam = a.cam
                and p.lat between zc.la_min - 0.0004 and zc.la_max + 0.0004
                and p.lon between zc.lo_min - 0.0004 and zc.lo_max + 0.0004
   where _dist_a_tramo_m(p.lat, p.lon,
           (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
           (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8) <= 45)
select zc.parroquia, zc.zona, a.cam, a.desde,
       coalesce(c.n, 0),
       zc.id, zc.nombre, zc.tramo, zc.metros, zc.orden,
       zc.geom, (t.id is not null)
  from zona_calles zc
  join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
  left join cuantas c on c.cam = a.cam
  left join tocado  t on t.id = zc.id
 order by zc.parroquia, zc.zona, zc.orden
$function$;

-- ═══ gps_celdas_del_dia ════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.gps_celdas_del_dia(p_fecha date, p_minutos_tramo integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare n int;
begin
  insert into gps_celdas (f, celda)
  select distinct p_fecha,
         _celda(t.la + (t.lat - t.la) * (i::numeric / greatest(t.pasos,1)),
                t.lo + (t.lon - t.lo) * (i::numeric / greatest(t.pasos,1)))
    from (
      select pos.la, pos.lo, pos.lat, pos.lon,
             ceil(greatest(_dist_a_tramo_m(pos.la, pos.lo, pos.lat, pos.lon, pos.lat, pos.lon), 1) / 40.0)::int pasos
        from (
          select p.lat, p.lon,
                 lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0, p.ts
            from gps_posiciones p
           where p.ts >= (p_fecha::timestamp at time zone 'America/Caracas')
     and p.ts <  ((p_fecha + 1)::timestamp at time zone 'America/Caracas')
          window w as (partition by p.cam order by p.ts)
        ) pos
       where pos.t0 is not null
         -- ⛔ Un tramo largo NO se rellena: unir los dos extremos de un silencio
         -- de 57 minutos marcaria como recorridas calles por las que nadie paso.
         and extract(epoch from (pos.ts - pos.t0))/60.0 <= p_minutos_tramo
    ) t, generate_series(0, least(t.pasos, 200)) i
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ═══ gps_calcular_dia ══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.gps_calcular_dia(p_f date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- El día es el del NEGOCIO: hora de Venezuela, no la del servidor.
  v_f    date    := coalesce(p_f, (now() at time zone 'America/Caracas')::date);
  -- Tramo máximo que se acepta como medido. Más que esto es un hueco, y un hueco
  -- no se rellena: ni de ralentí, ni de nada.
  v_tope numeric := 15;
  -- Por debajo de esto el odómetro no se movió. 50 m: el odómetro lo calcula el
  -- propio equipo GPS y tiene ruido; pedirle 0,00 exacto sería creerle una
  -- precisión que no tiene.
  v_quieto numeric := 0.05;
  v_n    integer := 0;
begin
  with p as (
    select
      cam, ts, velocidad, ignicion, odometro,
      lag(ts)        over w as ts_ant,
      lag(ignicion)  over w as ign_ant,
      lag(velocidad) over w as vel_ant,
      lag(odometro)  over w as odo_ant
    from gps_posiciones
    where ts >= (v_f::timestamp at time zone 'America/Caracas')
     and ts <  ((v_f + 1)::timestamp at time zone 'America/Caracas')
    window w as (partition by cam order by ts)
  ),
  q as (
    select *,
      -- ¿El camión se movió DURANTE el hueco? El odómetro atraviesa el silencio;
      -- la ignición del punto anterior solo dice cómo estaba cuando se calló.
      -- Solo se descarta con prueba: los dos odómetros presentes y quietos.
      (ign_ant is true
       and not (odometro is not null and odo_ant is not null
                and (odometro - odo_ant) < v_quieto)) as andando
    from p
  ),
  d as (
    select
      cam,
      count(*)::int as puntos,
      -- Medida de confianza del día: el hueco más largo con el camión andando.
      -- El del día completo lo domina la noche en la base y no mide nada.
      coalesce(max(extract(epoch from (ts - ts_ant))/60)
               filter (where andando), 0)::int as hueco_max_min,
      -- El bruto se guarda igual: si crece de noche, el equipo se está apagando.
      coalesce(max(extract(epoch from (ts - ts_ant))/60), 0)::int as hueco_max_bruto_min,
      -- La mediana es el margen real de la hora de salida y de regreso — sobre los
      -- tramos en que el camión estaba trabajando, no sobre las horas que durmió.
      percentile_cont(0.5) within group (
        order by case when ign_ant is true
                      then extract(epoch from (ts - ts_ant))/60 end
      ) as cadencia_med_min,
      count(odometro)                       as con_odo,
      max(odometro) - min(odometro)         as km_odo,
      -- Encendido y sin moverse, contando solo tramos efectivamente medidos.
      coalesce(sum(
        case when ign_ant is true
              and coalesce(vel_ant, 0) <= 3
              and extract(epoch from (ts - ts_ant))/60 <= v_tope
             then extract(epoch from (ts - ts_ant))/60
             else 0 end
      ), 0)::int as min_ralenti,
      -- Primera y última vez que la unidad se movió de verdad (no ruido de GPS parado).
      min(ts) filter (where velocidad > 3) as primera_salida,
      max(ts) filter (where velocidad > 3) as ultimo_regreso
    from q
    group by cam
  )
  insert into gps_dia (
    cam, f, km_gps, km_gps_metodo, primera_salida, ultimo_regreso,
    min_ralenti, puntos, hueco_max_min, hueco_max_bruto_min, cadencia_med_min, calculado
  )
  select
    cam, v_f,
    -- Los cast a numeric no son adorno: `percentile_cont` devuelve double precision
    -- y `round(double precision, int)` no existe en Postgres. La función se crea
    -- igual y revienta recién al correrla.
    case when con_odo >= 2 then round(greatest(km_odo, 0)::numeric, 2) end,
    case when con_odo >= 2 then 'odometro' else 'sin_odometro' end,
    primera_salida, ultimo_regreso,
    min_ralenti, puntos, hueco_max_min, hueco_max_bruto_min,
    round(cadencia_med_min::numeric, 2),
    now()
  from d
  on conflict (cam, f) do update set
    km_gps              = excluded.km_gps,
    km_gps_metodo       = excluded.km_gps_metodo,
    primera_salida      = excluded.primera_salida,
    ultimo_regreso      = excluded.ultimo_regreso,
    min_ralenti         = excluded.min_ralenti,
    puntos              = excluded.puntos,
    hueco_max_min       = excluded.hueco_max_min,
    hueco_max_bruto_min = excluded.hueco_max_bruto_min,
    cadencia_med_min    = excluded.cadencia_med_min,
    calculado           = excluded.calculado;
    -- `vueltas` NO se toca: la llena otra pieza cuando exista la geocerca del botadero.

  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

-- ═══ gps_contar_vueltas ════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.gps_contar_vueltas(p_f date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- El día es el del NEGOCIO: hora de Venezuela.
  v_f       date    := coalesce(p_f, (now() at time zone 'America/Caracas')::date);
  v_corte   numeric := 20;    -- minutos fuera que separan dos visitas
  v_min_min numeric := 2;     -- lo que tiene que durar una visita para ser descarga
  v_n       integer := 0;
begin
  with p as (
    select g.cam, g.ts,
           exists (select 1 from v_geocercas_vertedero vc
                    where point(g.lon, g.lat) <@ vc.poli) as adentro
    from gps_posiciones g
    where g.ts >= (v_f::timestamp at time zone 'America/Caracas')
     and g.ts <  ((v_f + 1)::timestamp at time zone 'America/Caracas')
  ),
  dentro as (
    select cam, ts,
           lag(ts) over (partition by cam order by ts) as ts_ant
    from p where adentro
  ),
  marcada as (
    select cam, ts,
           -- Nueva visita cuando es la primera del día o cuando estuvo más de `v_corte`
           -- minutos sin aparecer adentro.
           case when ts_ant is null
                  or extract(epoch from (ts - ts_ant))/60 > v_corte
                then 1 else 0 end as nueva
    from dentro
  ),
  agrupada as (
    select cam, ts, sum(nueva) over (partition by cam order by ts) as visita
    from marcada
  ),
  visitas as (
    select cam, visita, min(ts) ini, max(ts) fin,
           extract(epoch from (max(ts) - min(ts)))/60 as minutos
    from agrupada group by cam, visita
  )
  update gps_dia d
     set vueltas = coalesce(v.n, 0)
    from (
      select cam, count(*)::int n from visitas
       where minutos >= v_min_min
       group by cam
    ) v
   where d.f = v_f and d.cam = v.cam;

  get diagnostics v_n = row_count;

  -- ⛔ Un día con posiciones y CERO visitas tiene que quedar en 0, no en NULL. NULL se
  -- lee como «no se midió» y 0 como «no fue»: son cosas distintas y la diferencia es
  -- justo lo que hay que poder ver al lado de la planilla.
  update gps_dia d
     set vueltas = 0
   where d.f = v_f and d.vueltas is null and coalesce(d.puntos,0) > 0;

  return v_n;
end
$function$;

-- ═══ gps_reenvio_cuadre ════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.gps_reenvio_cuadre(p_desde date DEFAULT (CURRENT_DATE - 7))
 RETURNS TABLE(cam text, f date, imei text, posiciones bigint, enviadas integer, fallidas integer, faltan bigint, estado text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with arranque as (
      select (select valor from configuracion where clave = 'gps_reenvio_desde')::timestamptz t
    ), pos as (
      select p.cam, (p.ts at time zone 'America/Caracas')::date f, count(*) n
        from gps_posiciones p
        left join gps_reenvio_estado s on s.cam = p.cam, arranque a
       where p.ts >= (p_desde::timestamp at time zone 'America/Caracas')
         -- ⛔ Lo anterior a que ESTA unidad entrara no es un envio que falta.
         --    Manda su propia marca; si no tiene, la de la flota.
         and (coalesce(s.reenvio_desde, a.t) is null or p.ts >= coalesce(s.reenvio_desde, a.t))
       group by 1, 2
    )
    select pos.cam, pos.f, e.imei,
           pos.n, coalesce(d.enviadas, 0), coalesce(d.fallidas, 0),
           pos.n - coalesce(d.enviadas, 0),
           case
             when e.imei is null                       then 'sin IMEI: no se manda'
             when coalesce(d.enviadas, 0) = 0          then 'nada salió'
             when pos.n - coalesce(d.enviadas, 0) = 0  then 'cuadra'
             when pos.n - coalesce(d.enviadas, 0) <= 2 then 'cuadra (en camino)'
             else 'FALTAN'
           end
      from pos
      join gps_equipos e on e.cam = pos.cam
      left join gps_reenvio_dia d on d.cam = pos.cam and d.f = pos.f
     order by pos.f desc, pos.cam
  $function$;

-- ═══ paso_por_aqui ═════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.paso_por_aqui(p_lat double precision, p_lon double precision, p_radio_m integer DEFAULT 120, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_minutos_tramo integer DEFAULT 5)
 RETURNS TABLE(f date, cam text, hora timestamp with time zone, dist_m integer, por text, velocidad numeric, min_del_tramo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desde date := p_desde; v_hasta date := p_hasta;
begin
  perform gps_ve_o_falla();
  return query
  with par as (
    select p.cam, p.ts, p.lat, p.lon, p.velocidad,
           lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0
      from gps_posiciones p
     where (v_desde is null or p.ts >= (v_desde::timestamp at time zone 'America/Caracas'))
       and (v_hasta is null or p.ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
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
end $function$;

-- ═══ paso_por_poligono ═════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.paso_por_poligono(p_poli jsonb, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_minutos_tramo integer DEFAULT 5)
 RETURNS TABLE(f date, cam text, hora timestamp with time zone, por text, min_del_tramo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     where (v_desde is null or p.ts >= (v_desde::timestamp at time zone 'America/Caracas'))
       and (v_hasta is null or p.ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
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
end $function$;

-- ═══ dias_por_aqui ═════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.dias_por_aqui(p_lat double precision, p_lon double precision, p_radio_m integer DEFAULT 120, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(f date, estado text, unidades text, pasadas integer, primera text, ultima text, dist_min_m integer, hueco_max_min integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desde date := p_desde; v_hasta date := p_hasta;
begin
  perform gps_ve_o_falla();
  return query
  with dias as (
    select distinct (ts at time zone 'America/Caracas')::date ff
      from gps_posiciones
     where (v_desde is null or ts >= (v_desde::timestamp at time zone 'America/Caracas'))
       and (v_hasta is null or ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
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
         and (v_desde is null or ts >= (v_desde::timestamp at time zone 'America/Caracas'))
         and (v_hasta is null or ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
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
end $function$;

-- ═══ dias_por_poligono ═════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.dias_por_poligono(p_poli jsonb, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(f date, estado text, unidades text, pasadas integer, primera text, ultima text, dist_min_m integer, hueco_max_min integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desde date := p_desde; v_hasta date := p_hasta;
begin
  perform gps_ve_o_falla();
  return query
  with dias as (
    select distinct (ts at time zone 'America/Caracas')::date ff
      from gps_posiciones
     where (v_desde is null or ts >= (v_desde::timestamp at time zone 'America/Caracas'))
       and (v_hasta is null or ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
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
         and (v_desde is null or ts >= (v_desde::timestamp at time zone 'America/Caracas'))
         and (v_hasta is null or ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
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
end $function$;

commit;

-- ── VERIFICAR DESPUES DE CORRER ──────────────────────────────────────────────
-- 1. Que no quede ningun predicado viejo (debe dar 0):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosrc like '%gps_posiciones%'
--    and p.prosrc ~ '\)::date (=|>=|<=) [a-z_]';
--
-- 2. Que el indice entre de verdad (debe decir Index Only Scan, no Parallel/Seq):
-- explain (analyze, buffers) select count(*) from gps_posiciones p
--  where p.ts >= ((current_date - 1)::timestamp at time zone 'America/Caracas')
--    and p.ts <  ( current_date     ::timestamp at time zone 'America/Caracas');
--
-- 3. Que el resultado no cambio: correr `paso_por_aqui`, `dias_por_aqui`,
--    `paso_por_poligono`, `dias_por_poligono`, `gps_reenvio_cuadre` y
--    `zona_cobertura_del_dia` con las mismas entradas de antes y comparar fila por fila.
--    ⚠️ Tienen candado de rol (`gps_ve_o_falla`): se prueban CON el claim de un usuario
--    con rol, no como `postgres`, o se esta probando otra cosa.
--
-- 4. Las tres que ESCRIBEN (`gps_calcular_dia`, `gps_contar_vueltas`,
--    `gps_celdas_del_dia`) se verifican recalculando un dia ya cerrado y comprobando
--    que la fila de `gps_dia` queda IDENTICA a la que estaba.
