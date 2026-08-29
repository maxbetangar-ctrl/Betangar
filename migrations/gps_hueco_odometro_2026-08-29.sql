-- BETANGAR — GPS: el hueco «andando sin reportar» se decide con el ODÓMETRO, no con la ignición
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. `hueco_max_min` es la medida de confianza del día: el rato más largo en
-- que el camión estuvo andando y no supimos dónde. Se calculaba como «el hueco más
-- largo que EMPEZÓ con el motor encendido». Medido sobre los 16 días de JAC-B010,
-- eso produce un falso positivo:
--
--   27/08 · 18:55 → 20:04 · 68,5 min · el punto de las 18:55 dice ignicion=true y
--   velocidad 42 km/h. Pero el odómetro de las 18:55 y el de las 20:04 son EL MISMO
--   (16987.68): el camión no recorrió ni un metro en esa hora.
--
-- Lo que pasó de verdad es que el camión venía andando, llegó, y se apagó ahí mismo.
-- El último reporte antes de callarse lo agarró en movimiento, y con el motor apagado
-- el equipo pasa a reportar 1 vez por hora. Ese primer tramo de ~60 min se contaba
-- como «andando sin reportar» y no lo era. El día quedaba marcado en ámbar como mal
-- medido cuando estaba bien medido.
--
-- ⚠️ La ignición del punto ANTERIOR describe cómo estaba el camión cuando se calló,
-- no cómo estuvo durante el silencio. Es justo la información que no tenemos.
--
-- QUÉ CAMBIA. El odómetro sí atraviesa el hueco: el equipo lo sigue acumulando aunque
-- no mande posiciones (medido el 14/08: durante 22 min sin una sola posición, el
-- odómetro subió 3,99 km). Entonces un hueco solo cuenta como «andando sin reportar»
-- cuando hay PRUEBA de movimiento, o cuando no se puede saber:
--
--   se descarta SOLO si los dos odómetros existen y la diferencia es < 50 m.
--
-- ⛔ El null NO descarta. Si falta el odómetro no sabemos si se movió, y una medida de
-- confianza que se calla cuando no sabe está mintiendo hacia el lado cómodo.
--
-- QUÉ NO CAMBIA (medido antes de tocar, sobre los 16 días): de 16 días, 15 dan el
-- mismo número. Los huecos de 61, 66, 57 y 41 min de otros días son REALES — el
-- odómetro sube durante ellos. El peor: el 19/08, 57 minutos sin reportar en los que
-- el camión recorrió 22,77 km que nadie sabe por dónde fueron. Este cambio NO los
-- tapa, y no debe: son el argumento para pedirle al proveedor que baje el intervalo
-- de reporte.
--
-- Reversa al final.

begin;

comment on column public.gps_dia.hueco_max_min is
  'Hueco más largo (min) en que el camión estuvo andando y no supimos dónde: empezó '
  'con el motor encendido Y el odómetro avanzó durante el hueco (o no hay odómetro '
  'para descartarlo). Es la medida de confianza del día. Un hueco con el odómetro '
  'quieto NO cuenta: ahí el camión estaba apagado, aunque el último reporte lo haya '
  'agarrado en movimiento.';

create or replace function public.gps_calcular_dia(p_f date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
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
    where (ts at time zone 'America/Caracas')::date = v_f
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
$fn$;

revoke all on function public.gps_calcular_dia(date) from public, anon, authenticated;

-- Los días ya calculados quedan con el número viejo hasta que se recalculen.
select public.gps_calcular_dia(f) from (select distinct f from gps_dia order by f) x;

commit;

-- ============================================================================
-- REVERSA: recrear la función de `migrations/gps_hueco_trabajo_2026-08-15.sql`
-- (el filter era `where ign_ant is true`, sin el CTE `q`) y recalcular.
-- ============================================================================
