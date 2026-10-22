-- ════════════════════════════════════════════════════════════════════════════
--  paso_por_aqui / dias_por_aqui — ¿qué días pasó un camión por ESTE punto?
--
--  POR QUÉ EXISTE, y es lo más serio que se le ha pedido a este módulo:
--  el 21/10/2026 la Alcaldía denunció que Betangar lleva **15 días sin pasar por
--  un sitio**. El GPS tiene el recorrido. Esto lo contesta con fechas y horas.
--
--  ⛔ LA DECISIÓN QUE DEFINE SI ESTO SIRVE COMO PRUEBA: SE MIDE AL TRAMO, NO AL
--     PUNTO. Medido el 21/10 sobre 8.768 tramos con el camión andando: entre un
--     punto y el siguiente hay **265 m** de mediana, **928 m** en el p90 y hasta
--     3,9 km. O sea que preguntar «¿hay un punto a menos de 100 m del sitio?»
--     **perdería la mayoría de las pasadas** y nos haría ver culpables: el camión
--     pasa la calle entera entre dos reportes.
--     Se mide la distancia del sitio al SEGMENTO que une dos posiciones
--     consecutivas. Un camión que entró por una punta y salió por la otra cuenta.
--
--  ⛔ Y LA DECISIÓN QUE EVITA FABRICAR PRUEBA: UN TRAMO LARGO NO ES UN RECORRIDO.
--     El equipo se calla hasta 57 minutos con el motor encendido (medido el
--     19/08: 22,77 km sin una sola posición). Unir con una recta los dos extremos
--     de un silencio así y decir «pasó por todo lo que cruza esa recta» sería
--     **inventar un recorrido que nadie midió**, y en una denuncia eso es peor
--     que no tener nada. Los tramos con más de `p_minutos_tramo` (5 por defecto)
--     NO cuentan como pasada: se informan aparte como «no se sabe».
--     [[norma-respaldo-que-inventa-un-dato]] [[norma-la-falta-de-dato-no-es-un-dato]]
--
--  ⛔ Y LA TERCERA: «NO HAY PUNTOS» NO ES «NO PASÓ».
--     `dias_por_aqui` no contesta sí/no: contesta **tres** estados por día —
--     `pasó`, `NO pasó` y `no se puede afirmar`— y el tercero existe para los
--     días en que el rastreo tuvo un hueco grande o la unidad no reportó. Decir
--     «no pasó» de un día que no se midió es acusar a un inocente, y acá el
--     inocente puede ser el chofer o puede ser la empresa.
--
--  ⚠️ LÍMITES QUE HAY QUE DECIR SIEMPRE QUE SE USE ESTO:
--   · El historial empieza el **14/08/2026**. Antes no existe y no se recupera.
--   · Son **10 de 12** unidades: JAC-B011 y JAC-B012 no están en la cuenta del
--     proveedor, así que de ellas no hay NI UN punto. Si la ruta en disputa la
--     cubrió una de esas dos, esto no puede probar nada.
--   · La geometría es plana local (válida para unos pocos km, que es la escala de
--     una calle o un sector). No sirve para distancias largas.
-- ════════════════════════════════════════════════════════════════════════════

-- Distancia en metros de un punto a un segmento, en el plano local. A esta
-- escala (<5 km) el error de aplanar la Tierra es de centímetros.
create or replace function _dist_a_tramo_m(
  p_lat double precision, p_lon double precision,
  a_lat double precision, a_lon double precision,
  b_lat double precision, b_lon double precision
) returns double precision
language sql immutable as $$
  with m as (
    select 111320.0 * cos(radians(p_lat)) kx, 110540.0 ky
  ), v as (
    select (a_lon - p_lon) * kx ax, (a_lat - p_lat) * ky ay,
           (b_lon - p_lon) * kx bx, (b_lat - p_lat) * ky by
      from m
  ), s as (
    select ax, ay, bx, by, (bx - ax) dx, (by - ay) dy from v
  ), t as (
    -- Proyección del origen sobre el segmento, acotada a [0,1]: así se mide al
    -- TRAMO y no a su recta infinita.
    select ax, ay, dx, dy,
           case when dx*dx + dy*dy = 0 then 0
                else greatest(0, least(1, -(ax*dx + ay*dy) / (dx*dx + dy*dy))) end k
      from s
  )
  select sqrt(power(ax + k*dx, 2) + power(ay + k*dy, 2)) from t
$$;

comment on function _dist_a_tramo_m(double precision,double precision,double precision,
  double precision,double precision,double precision) is
  'Metros del punto (p_lat,p_lon) al SEGMENTO a→b. Acotada a [0,1]: mide al tramo, no a '
  'su recta infinita. Plano local: válida a escala de calle/sector, no para km largos.';

-- ── Las pasadas, una por una ────────────────────────────────────────────────
create or replace function paso_por_aqui(
  p_lat double precision,
  p_lon double precision,
  p_radio_m integer default 120,
  p_desde date default null,
  p_hasta date default null,
  p_minutos_tramo integer default 5
) returns table (
  f              date,
  cam            text,
  hora           timestamptz,
  dist_m         integer,
  por            text,
  velocidad      numeric,
  min_del_tramo  numeric
)
language sql stable security definer set search_path = public as $$
  with par as (
    select p.cam, p.ts, p.lat, p.lon, p.velocidad,
           lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0
      from gps_posiciones p
     where (p_desde is null or (p.ts at time zone 'America/Caracas')::date >= p_desde)
       and (p_hasta is null or (p.ts at time zone 'America/Caracas')::date <= p_hasta)
    window w as (partition by p.cam order by p.ts)
  ), medido as (
    select (ts at time zone 'America/Caracas')::date f, cam, ts, velocidad,
           extract(epoch from (ts - t0))/60.0 mins,
           -- Con un punto anterior usable se mide al tramo; si no, al punto.
           case when la is null then _dist_a_tramo_m(p_lat,p_lon,lat,lon,lat,lon)
                else _dist_a_tramo_m(p_lat,p_lon,la,lo,lat,lon) end d,
           (la is not null) hay_tramo
      from par
  )
  select f, cam, ts, round(d)::int,
         case when not hay_tramo then 'punto'
              when mins <= p_minutos_tramo then 'tramo'
              else 'tramo largo (no cuenta)' end,
         velocidad,
         round(mins::numeric, 1)
    from medido
   where d <= p_radio_m
     -- Un tramo que tardó más que el tope NO cuenta como pasada (decisión 2),
     -- pero se devuelve marcado para que se pueda ver que hubo uno.
   order by f desc, ts
$$;

-- ── El resumen por día, con TRES estados ────────────────────────────────────
create or replace function dias_por_aqui(
  p_lat double precision,
  p_lon double precision,
  p_radio_m integer default 120,
  p_desde date default null,
  p_hasta date default null
) returns table (
  f            date,
  estado       text,
  unidades     text,
  pasadas      integer,
  primera      text,
  ultima       text,
  dist_min_m   integer,
  hueco_max_min integer
)
language sql stable security definer set search_path = public as $$
  with dias as (
    -- Los días que el rastreo SÍ estuvo midiendo. Un día que no existe acá no es
    -- un día sin pasar: es un día sin medir, y son cosas distintas.
    select distinct (ts at time zone 'America/Caracas')::date f
      from gps_posiciones
     where (p_desde is null or (ts at time zone 'America/Caracas')::date >= p_desde)
       and (p_hasta is null or (ts at time zone 'America/Caracas')::date <= p_hasta)
  ), pas as (
    select * from paso_por_aqui(p_lat, p_lon, p_radio_m, p_desde, p_hasta)
     where por <> 'tramo largo (no cuenta)'
  ), huecos as (
    -- El hueco más largo del día CON EL MOTOR ENCENDIDO: es la medida de cuánto
    -- se puede confiar en un «no pasó» de ese día.
    select f, max(mins)::int hueco from (
      -- ⛔ PARTICIONADO POR CAM **Y POR DÍA**. La primera versión solo partía por
      -- `cam`, así que el hueco de la PRIMERA posición del día se medía contra la
      -- ÚLTIMA del día anterior: daba 792, 928 y hasta 2.270 minutos, que es el
      -- camión durmiendo. Con eso, cualquier día sin pasada quedaba como «no se
      -- puede afirmar» y el instrumento no servía para lo contrario — y encima
      -- habría puesto un número falso delante de la Alcaldía.
      select (ts at time zone 'America/Caracas')::date f,
             extract(epoch from (ts - lag(ts) over (
               partition by cam, (ts at time zone 'America/Caracas')::date order by ts)))/60.0 mins
        from gps_posiciones
       where ignicion
         and (p_desde is null or (ts at time zone 'America/Caracas')::date >= p_desde)
         and (p_hasta is null or (ts at time zone 'America/Caracas')::date <= p_hasta)
    ) x where mins is not null group by f
  )
  select d.f,
         case when p.n > 0 then 'pasó'
              when coalesce(h.hueco, 0) >= 20 then 'no se puede afirmar'
              else 'NO pasó' end,
         coalesce(p.unis, '—'),
         coalesce(p.n, 0)::int,
         to_char(p.pri at time zone 'America/Caracas', 'HH24:MI'),
         to_char(p.ult at time zone 'America/Caracas', 'HH24:MI'),
         p.dmin::int,
         coalesce(h.hueco, 0)
    from dias d
    left join (
      select f, count(*) n, min(hora) pri, max(hora) ult, min(dist_m) dmin,
             string_agg(distinct cam, ', ' order by cam) unis
        from pas group by f
    ) p on p.f = d.f
    left join huecos h on h.f = d.f
   order by d.f desc
$$;

comment on function dias_por_aqui(double precision,double precision,integer,date,date) is
  '¿Qué días se pasó por este punto? TRES estados a propósito: «pasó», «NO pasó» y '
  '«no se puede afirmar» (ese día el rastreo tuvo un hueco de 20 min o más con el motor '
  'encendido). Decir «no pasó» de un día que no se midió es acusar a un inocente. '
  'Un día que no aparece en la lista es un día SIN MEDIR, no un día sin pasar.';

revoke all on function paso_por_aqui(double precision,double precision,integer,date,date,integer) from anon;
revoke all on function dias_por_aqui(double precision,double precision,integer,date,date) from anon;

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
-- ⛔ Esto va a servir de prueba en una denuncia, así que no alcanza con que
-- «corra»: hay que comprobar que ENCUENTRA lo que está y que NO encuentra lo que
-- no está. Un buscador que siempre dice «no pasó» se ve igual que la inocencia
-- de la Alcaldía, y uno que siempre dice «pasó» no sirve para defenderse.
do $$
declare lat double precision; lon double precision; n int; n_lejos int; d int;
begin
  -- Se toma un punto REAL por donde pasó un camión: ahí la respuesta tiene que
  -- ser «sí» por construcción. Si da «no», la medición está rota.
  select p.lat, p.lon into lat, lon from gps_posiciones p
   where p.ignicion and p.velocidad > 10 order by p.ts desc limit 1;
  if lat is null then raise exception 'CONTROL: no hay posiciones para probar'; end if;

  select count(*) into n from paso_por_aqui(lat, lon, 120, (current_date - 3), current_date);
  if n = 0 then
    raise exception 'CONTROL POSITIVO FALLÓ: un punto por donde el camión pasó de verdad '
      'dio CERO pasadas. La distancia o el filtro de fechas están mal.';
  end if;

  -- Y el negativo: un punto a 40 km de la zona NO puede dar pasadas.
  select count(*) into n_lejos from paso_por_aqui(lat + 0.36, lon, 120, (current_date - 3), current_date);
  if n_lejos > 0 then
    raise exception 'CONTROL NEGATIVO FALLÓ: un punto a ~40 km dio % pasadas. La distancia '
      'no está midiendo lo que dice.', n_lejos;
  end if;

  -- La distancia al propio punto tiene que ser ~0.
  select round(_dist_a_tramo_m(lat, lon, lat, lon, lat, lon))::int into d;
  if d > 1 then raise exception 'CONTROL: la distancia a sí mismo dio % m', d; end if;

  raise notice 'OK · encuentra lo que está (% pasadas), no encuentra lo que no está, '
    'y la distancia a sí mismo es 0', n;
end $$;
