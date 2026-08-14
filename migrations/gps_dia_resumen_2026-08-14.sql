-- BETANGAR — GPS: el resumen del día por unidad
-- Fecha: 2026-08-14
--
-- QUÉ HACE: destila `gps_posiciones` (detalle crudo, podable) en `gps_dia` (12 filas
-- al día, PERMANENTE). Cuando el detalle se pode, el resumen sigue sosteniendo la
-- auditoría: cuántos km hizo esa unidad ese día, a qué hora salió, a qué hora volvió,
-- cuánto estuvo encendida sin moverse — y CON CUÁNTA MEDICIÓN se sostiene todo eso.
--
-- ⚠️ POR QUÉ EL KM SALE DEL ODÓMETRO Y NO DE SUMAR DISTANCIAS ENTRE PUNTOS
-- Medido el 14/08/2026: el equipo estuvo 22 minutos sin reportar una sola posición,
-- y el odómetro igual subió 3,99 km. El contador del equipo SOBREVIVE al hueco de
-- señal; la línea entre puntos no. Sumar distancias entre puntos subestima 15–30 %
-- en ciudad, y se rompe justo en los días malos. Por eso:
--   · si hay odómetro en 2 o más puntos → km_gps = último − primero, `metodo='odometro'`
--   · si no lo hay → se deja NULL y `metodo='sin_odometro'`. NO se inventa un número.
-- El método se GUARDA porque un km calculado de dos maneras distintas no se puede
-- mostrar igual: un número que el dueño no puede explicar no se muestra.
--
-- 🔴 EL ODÓMETRO LO CALCULA EL GPS, NO EL TABLERO (confirmado por el proveedor el
-- 14/08/2026). Por eso acá se usa la DIFERENCIA dentro del día y jamás el valor
-- absoluto: lo sincronizan con el tablero al instalar el equipo y desde ahí acumula
-- solo, con ~3 % de sesgo que SE VA SEPARANDO con el tiempo. La diferencia de un día
-- arrastra 3 % de lo recorrido ESE día; el valor absoluto arrastra el sesgo de toda
-- la vida del equipo.
-- ⛔ Por eso mismo `gps_dia.km_gps` NO sirve para programar el cambio de aceite:
-- sobre un ciclo de 5.000 km, 3 % son 150 km, y se acumulan ciclo tras ciclo. El
-- servicio se sigue contando desde `mantenimientos`; esto solo sirve para AVISAR una
-- discrepancia, nunca para fijar la fecha.
--
-- ⚠️ EL RALENTÍ NO CUENTA LOS HUECOS. Si el equipo deja de reportar 3 horas con la
-- ignición encendida, sumar ese intervalo daría 180 minutos de ralentí que nadie
-- midió. Solo se suman los tramos de hasta TOPE_TRAMO_MIN; lo que pasa dentro de un
-- hueco largo no se sabe, y no saberlo se dice, no se rellena.
--
-- ⛔ `vueltas` SIGUE EN NULL a propósito: la geocerca del botadero todavía no existe
-- en `sitios_asistencia`. Contar vueltas sin ella sería inventar. Además, con radio de
-- 150 m y sondeo cada 2 min, un camión a 30 km/h cruza la geocerca en 18 segundos y se
-- perdería ~85 % de los pasos: cuando se cargue, tiene que ser con radio grande
-- (600–800 m) y contando PERMANENCIAS, no cruces.

begin;

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
      -- Medida de confianza del día: el hueco más largo sin reportar.
      coalesce(max(extract(epoch from (ts - ts_ant))/60), 0)::int as hueco_max_min,
      -- La mediana es el margen real de la hora de salida y de regreso.
      percentile_cont(0.5) within group (
        order by extract(epoch from (ts - ts_ant))/60
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
    min_ralenti, puntos, hueco_max_min, cadencia_med_min, calculado
  )
  select
    cam, v_f,
    -- Los cast a numeric no son adorno: `percentile_cont` devuelve double precision
    -- y `round(double precision, int)` no existe en Postgres. La función se crea
    -- igual y revienta recién al correrla.
    case when con_odo >= 2 then round(greatest(km_odo, 0)::numeric, 2) end,
    case when con_odo >= 2 then 'odometro' else 'sin_odometro' end,
    primera_salida, ultimo_regreso,
    min_ralenti, puntos, hueco_max_min, round(cadencia_med_min::numeric, 2),
    now()
  from d
  on conflict (cam, f) do update set
    km_gps           = excluded.km_gps,
    km_gps_metodo    = excluded.km_gps_metodo,
    primera_salida   = excluded.primera_salida,
    ultimo_regreso   = excluded.ultimo_regreso,
    min_ralenti      = excluded.min_ralenti,
    puntos           = excluded.puntos,
    hueco_max_min    = excluded.hueco_max_min,
    cadencia_med_min = excluded.cadencia_med_min,
    calculado        = excluded.calculado;
    -- `vueltas` NO se toca: la llena otra pieza cuando exista la geocerca del botadero.

  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

-- Recalcula el día en curso y cierra el anterior. Se llama cada hora: el día de hoy
-- se va actualizando y el de ayer queda cerrado sin depender de que algo corra a una
-- hora exacta. Es barato: son 12 filas por día.
create or replace function public.gps_tick_dia()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  a int; b int;
begin
  a := public.gps_calcular_dia(v_hoy);
  b := public.gps_calcular_dia(v_hoy - 1);
  return format('hoy %s: %s unidades · ayer: %s unidades', v_hoy, a, b);
end
$fn$;

-- Solo el servidor las corre. `anon` viaja en el bundle del navegador.
revoke all on function public.gps_calcular_dia(date) from public, anon, authenticated;
revoke all on function public.gps_tick_dia()        from public, anon, authenticated;

commit;
