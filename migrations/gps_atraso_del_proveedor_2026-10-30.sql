-- BETANGAR — GPS: guardar el ATRASO con que el proveedor nos entrega cada posición
-- Fecha: 2026-10-30
--
-- ⛔ QUÉ PROBLEMA RESUELVE. El 23/10/2026 el proveedor entregó el día con **mediana de
--    43,2 minutos** de atraso, p95 de **121 min** y pico de **170 min**: 4.022 de 6.780
--    posiciones (el 59% del día) llegaron con más de media hora. El 27/10 fue el 32% y el
--    28/10 el 19%. En total, 7.986 de 320.199 posiciones (2,5%) llegaron con +30 min.
--    Nadie se enteró, y hoy nadie puede sacar ese número sin escribir SQL a mano.
--
-- ✅ LO QUE **NO** ES, y se midió antes de construir nada:
--    · **No es pérdida de dato.** El 23/10 tiene 6.780 posiciones y 565 por unidad, dentro
--      de la banda normal (524-663). El sondeo baja por rango con cursor, no solo el último
--      punto, así que recupera lo que llegó tarde.
--    · **No es un hueco en el mapa de la Alcaldía.** `gps_reenvio_cuadre('2026-10-23')` dice
--      `cuadra` en las 10 unidades con IMEI, `faltan 0` en todas: recibieron cada posición.
--    ⇒ El daño es TEMPORAL: mientras el dato no llega, su pantalla muestra al camión quieto
--      donde estuvo por última vez. Y un camión que su mapa muestra detenido dos horas en
--      una esquina es exactamente «pensar que no estuve en un sitio que sí estuve».
--
-- ⚠️ EL NÚMERO TIENE UN PISO QUE ES NUESTRO. `creado - ts` mezcla lo que tardó el proveedor
--    con lo que tardó nuestro sondeo en pasar a buscar. El cron del sondeo es `* * * * *`
--    (cada minuto), así que el piso es ~1 min y la mediana normal medida es **0,3 min**.
--    Un atraso de 0,3 a 1 min NO se le reclama a nadie. ⛔ Si algún día el sondeo se
--    espacia, este número sube sin que el proveedor haya hecho nada: el cron es parte de la
--    interpretación y hay que mirarlo antes de acusar.
--
-- Las 3 columnas, y qué contesta cada una:
--   `atraso_p50_min`   la entrega típica del día. Normal: 0,3. El 23/10: 43,2.
--   `atraso_p95_min`   la cola. Normal: 1,0. El 23/10: 121.
--   `atraso_tardias`   cuántas posiciones llegaron con +30 min — o sea cuántas veces su
--                      pantalla estuvo desactualizada de verdad. Normal: 2 a 15. El 23/10: 4.022.
--
-- 📏 Verificación: recalcular el 23/10 y comprobar que las columnas reproducen esos números,
--    que se midieron por fuera de la función. Si no coinciden, la función está mal.

begin;

alter table public.gps_dia
  add column if not exists atraso_p50_min numeric,
  add column if not exists atraso_p95_min numeric,
  add column if not exists atraso_tardias integer;

comment on column public.gps_dia.atraso_p50_min is
  'Mediana de minutos entre que la posición OCURRIÓ (ts) y la GUARDAMOS (creado), ese día. '
  'Mide la entrega del proveedor, con un piso nuestro: el sondeo corre cada minuto. '
  '⛔ No es pérdida de dato ni hueco en el mapa de la Alcaldía: es atraso de la vista en vivo.';
comment on column public.gps_dia.atraso_p95_min is
  'Percentil 95 del mismo atraso. Normal ~1 min; el 23/10/2026 dio 121 min.';
comment on column public.gps_dia.atraso_tardias is
  'Cuántas posiciones de ese día llegaron con más de 30 min de atraso — cuántas veces la '
  'pantalla de la Alcaldía mostró al camión donde ya no estaba. Normal 2-15; el 23/10: 4.022.';
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
      cam, ts, velocidad, ignicion, odometro, creado,
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
      -- 📡 EL ATRASO DE ENTREGA DEL PROVEEDOR. `ts` es cuando la posicion OCURRIO y
      -- `creado` cuando la guardamos: la diferencia es lo que tardo en estar disponible.
      -- ⚠️ Incluye un piso NUESTRO: el sondeo corre cada minuto (cron `* * * * *`), asi
      --    que ~0,3 min es lo normal y no es culpa del proveedor.
      -- ⛔ NO es perdida de dato: medido el 30/10, el peor dia (23/10) tiene 6.780
      --    posiciones —banda normal— y el cuadre del reenvio dice `cuadra` en las 10
      --    unidades. Lo que se degrada es la vista EN VIVO: mientras el dato no llega,
      --    el mapa de la Alcaldia muestra el camion quieto donde estuvo por ultima vez,
      --    y eso se lee como «no estuvo ahi» — que es justo lo que no puede pasar.
      percentile_cont(0.5) within group (
        order by extract(epoch from (creado - ts))/60) as atraso_p50_min,
      percentile_cont(0.95) within group (
        order by extract(epoch from (creado - ts))/60) as atraso_p95_min,
      -- Cuantas llegaron tan tarde que el mapa de ellos estuvo desactualizado de verdad.
      count(*) filter (where creado - ts > interval '30 minutes')::int as atraso_tardias,
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
    min_ralenti, puntos, hueco_max_min, hueco_max_bruto_min, cadencia_med_min,
    atraso_p50_min, atraso_p95_min, atraso_tardias, calculado
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
    round(atraso_p50_min::numeric, 2), round(atraso_p95_min::numeric, 2), atraso_tardias,
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
    atraso_p50_min      = excluded.atraso_p50_min,
    atraso_p95_min      = excluded.atraso_p95_min,
    atraso_tardias      = excluded.atraso_tardias,
    calculado           = excluded.calculado;
    -- `vueltas` NO se toca: la llena otra pieza cuando exista la geocerca del botadero.

  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select gps_calcular_dia('2026-10-23');
-- select cam, puntos, atraso_p50_min, atraso_p95_min, atraso_tardias
--   from gps_dia where f = '2026-10-23' order by cam;
--   → el día entero tiene que dar tardías = 4.022 sumando las unidades (es una cuenta, se
--     puede sumar). La peor unidad fue JAC-B004: p50 44,63 · p95 152,92 · 473 tardías.
--     unidades. Esos números se midieron POR FUERA de la función el 30/10/2026 y la
--     verificación dio 0 discrepancias en las 22 unidades-día probadas (23/10 y 22/10).
-- Y un día normal (p. ej. 22/10) tiene que dar p50 ≈ 0,3 y p95 ≈ 1,0.
-- ⛔ Recalcular de a un día y con tope: el 30/10 unas pruebas sin tope tumbaron la base.
