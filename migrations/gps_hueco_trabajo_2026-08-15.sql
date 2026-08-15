-- BETANGAR — GPS: el hueco que importa es el del camión TRABAJANDO
-- Fecha: 2026-08-15
--
-- QUÉ PASÓ. La pantalla del mapa mostraba en ámbar «Hueco máx. 61 min» los dos días
-- que llevamos midiendo. Suena a falla del rastreo y no lo es: de noche, con el motor
-- apagado en la base, el equipo reporta UNA vez por hora. Medido:
--
--   día         hueco de todo el día     hueco con el motor encendido
--   14/08              60 min                      14 min
--   15/08              61 min                      14 min
--
-- O sea que el número que mirábamos era el camión DURMIENDO. Y es peor que un susto:
-- iba a decir ~60 TODOS los días, así que no distinguía un día bien medido de uno mal
-- medido. Una medida de confianza que da siempre lo mismo no mide nada.
--
-- QUÉ CAMBIA. `hueco_max_min` pasa a ser el hueco más largo **que empezó con el motor
-- encendido**: el rato en que el camión estuvo andando y no supimos dónde. Ese es el
-- que puede esconder una vuelta al botadero, y el único que justifica no cotejar el
-- día contra la planilla.
-- El hueco de todo el día no se pierde — se guarda aparte en `hueco_max_bruto_min`,
-- porque también dice algo: si crece mucho de noche, el equipo se está apagando.
-- `cadencia_med_min` pasa igual a medirse sobre los tramos con el motor encendido:
-- con las 6 filas de la noche adentro, la mediana hablaba de horas que nadie trabajó.
--
-- ⚠️ POR QUÉ «EMPEZÓ ENCENDIDO» Y NO «EMPEZÓ Y TERMINÓ ENCENDIDO». El hueco de las
-- 04:42→05:43 del 15/08 termina con la ignición en true (el chofer llegó y prendió).
-- Contarlo sería volver a contar la noche. Lo que define un hueco sospechoso es que
-- el camión estuviera trabajando CUANDO se calló, no cómo lo encontramos después.
--
-- Reversa al final del archivo.

begin;

alter table public.gps_dia
  add column if not exists hueco_max_bruto_min integer;

comment on column public.gps_dia.hueco_max_min is
  'Hueco más largo (min) que empezó con el motor ENCENDIDO: el rato en que el camión '
  'andaba y no supimos dónde. Es la medida de confianza del día.';
comment on column public.gps_dia.hueco_max_bruto_min is
  'Hueco más largo del día completo, incluida la noche con el motor apagado. Parado en '
  'la base el equipo reporta 1 vez por hora, así que este número ronda los 60 min todos '
  'los días: NO se muestra como si fuera una falla.';

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
  v_n    integer := 0;
begin
  with p as (
    select
      cam, ts, velocidad, ignicion, odometro,
      lag(ts)        over w as ts_ant,
      lag(ignicion)  over w as ign_ant,
      lag(velocidad) over w as vel_ant
    from gps_posiciones
    where (ts at time zone 'America/Caracas')::date = v_f
    window w as (partition by cam order by ts)
  ),
  d as (
    select
      cam,
      count(*)::int as puntos,
      -- Medida de confianza del día: el hueco más largo que empezó con el motor
      -- encendido. El del día completo lo domina la noche en la base y no mide nada.
      coalesce(max(extract(epoch from (ts - ts_ant))/60)
               filter (where ign_ant is true), 0)::int as hueco_max_min,
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
    from p
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

-- Los dos días ya calculados quedan con el número viejo hasta que se recalculen.
-- Se recalculan acá mismo: son 2 filas.
select public.gps_calcular_dia(f) from (select distinct f from gps_dia order by f) x;

commit;

-- ============================================================================
-- REVERSA (si hiciera falta volver atrás): recrear la función con
-- `max(...)` sin el `filter (where ign_ant is true)` en `hueco_max_min` y con
-- `percentile_cont` sin el `case`, tal como quedó en
-- `migrations/gps_dia_resumen_2026-08-14.sql`, y recalcular. La columna
-- `hueco_max_bruto_min` puede quedarse: no la lee nadie más.
-- ============================================================================
