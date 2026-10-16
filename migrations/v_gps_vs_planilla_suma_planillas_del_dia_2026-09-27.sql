-- ═══════════════════════════════════════════════════════════════════════════════
-- DOS ARREGLOS SOBRE `v_gps_vs_planilla`, los dos destapados por mirar la lista
--
-- Va DESPUÉS de `v_gps_vs_planilla_mira_checklist_2026-09-27.sql` (ya aplicada).
--
-- ═══ ARREGLO 1 · UN CAMIÓN CON DOS RUTAS SALÍA DOS VECES, Y LAS DOS MAL ═══
--
-- Al contar `estado_km` daban 19 días con «km NO cuadran» donde la medición previa
-- había dado 17, y con Jorwin corregido debía dar 16. Tres días aparecían REPETIDOS.
-- 📌 Un conteo que no cuadra con lo medido antes es una pregunta, no un redondeo.
--
-- ⛔ La causa NO era el checklist: `checklist` tiene CERO pares (cam, fecha)
--    repetidos. Era `planillas`, con **35 pares de dos filas** — que no son
--    duplicados sino **dos rutas distintas del mismo camión el mismo día**:
--      JAC-B008, 19/09 → planilla 01809 ruta CARMELO URDANETA (2 viajes)
--                      + planilla 01816 ruta CORREDORES       (1 viaje)
--
-- ⛔ El defecto es de la vista ORIGINAL: `gps_dia.vueltas` es el total del DÍA y se
--    comparaba contra los viajes de UNA planilla. Con dos rutas salían dos filas y
--    cada una comparaba el total contra una parte: las dos daban diferencia por
--    construcción. Ese 19/09 el GPS vio 3 vueltas y las planillas suman 3 viajes —
--    **el día cuadra perfecto** y la pantalla lo mostraba como dos días con problema.
--
-- ⚠️ Esta pantalla se usa para cobrar lo ejecutado (1.784 viajes sin facturar) y
--    para no facturar lo que no ocurrió. Un día bueno marcado como diferencia manda
--    a revisar algo que está bien y **enseña a ignorar la lista**.
--
--   estado                      antes   después
--   coincide                      182       183   (+1: el 19/09 del B008)
--   GPS ve MÁS viajes              25        22
--   GPS ve MENOS viajes             9         8
--   FILAS TOTALES                 297       294   (-3, las repetidas)
--
-- DECISIÓN: Máximo, 26/09/2026 — sumar las planillas del día.
--
-- ═══ ARREGLO 2 · EL GPS QUE ARRANCA TARDE ACUSABA AL CHOFER ═══
--
-- ⛔ ESTE ES UN DEFECTO DE LO QUE SE MONTÓ HOY, no heredado. La guarda de
--    «rastreo no concluyente» pedía >=200 puntos. Al mirar los días marcados
--    apareció que los 8 «positivos» (checklist dice MÁS km que el GPS) tenían entre
--    206 y 318 puntos: **pasaban la guarda** y acusaban al chofer.
--
--    Al comparar la ventana del GPS contra el horario declarado:
--
--      fecha     unidades   chofer salió    GPS empezó      retraso
--      29/08        5       05:35–06:23     12:06–12:16     347–391 min
--      02/09        3       05:24–05:38     14:08–14:58     525–566 min
--
--    El GPS **no midió la jornada: midió el final**. Terminó junto con el chofer
--    (19:36 contra 19:40) pero se perdió 6 a 9 horas del principio. Y son DOS
--    FECHAS CON LA FLOTA ENTERA ⇒ falla del proveedor ese día, no de los camiones.
--    [[gps-apagon-de-flota-avisa-al-proveedor]]
--
-- ⛔ **El chofer tenía razón en los 8 y la pantalla lo iba a mandar a explicarse.**
--    Es exactamente lo que el comentario del `app.js` advierte: «acusar a un chofer
--    con un día mal medido es acusar a un inocente con cara de dato objetivo».
--
-- EL UMBRAL SE MIDIÓ, sobre 245 días con >=200 puntos:
--   el GPS arranca en promedio 18 min después de la salida declarada (motor, señal)
--   mediana 18 min · p90 51 min · p95 86 min
--   más de 60 min: 17 días · **más de 120 min: 8 días**
--
-- 📌 Entre 86 min (p95) y 347 min (el peor real) NO HAY NADA. El corte en **120 min**
--    cae en el medio del vacío: saca los 8 días de apagón y **ningún otro**.
--    Se verificó uno por uno: los 8 son exactamente el 29/08 (B004, B006, B007,
--    B008, B009) y el 02/09 (B001, B004, B009).
--
-- RESULTADO de los dos arreglos juntos: la alarma pasa de **19 días a 8**.
--   km coinciden 207 · sin checklist 36 · rastreo no concluyente 28 ·
--   **km NO cuadran 8** · rastreo no concluyente (GPS arrancó tarde) 8 ·
--   día sin cerrar 7    (294 filas, sin repetidas)
--
-- ⚠️ Los 8 que quedan son los que SÍ hay que mirar, y son de otra naturaleza: el
--    GPS rastreó bien y el camión **siguió andando después de que el chofer cerró**
--    (el 05/09 el B008 cerró 13:57 y el GPS siguió hasta las 23:52). Dos de los 8
--    —04/09 B006 y 07/09 B007— tienen la ventana igual y el km al doble: **no están
--    explicados y no se inventa una explicación.**
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace view public.v_gps_vs_planilla as
select
    d.f                                   as fecha,
    d.cam,
    d.vueltas                             as vueltas_gps,
    pl.t                                  as viajes_planilla,
    d.vueltas - pl.t                      as diferencia,
    d.km_gps,
    pl.km                                 as km_planilla,
    pl.ch                                 as chofer_planilla,
    d.puntos,
    d.hueco_max_min,
    -- ⛔ Los textos NO cambian: `renderGpsVsPlanilla` filtra por ellos literalmente.
    --    Lo que cambia es contra QUÉ se compara: el total de viajes del día.
    case
        when pl.t is null then 'sin planilla'::text
        when d.vueltas is null then 'sin medir'::text
        when d.vueltas = pl.t then 'coincide'::text
        when coalesce(d.puntos, 0) < 200 or coalesce(d.hueco_max_min, 0) > 45 then 'diferencia NO concluyente'::text
        when d.vueltas > pl.t then 'GPS ve MÁS viajes'::text
        else 'GPS ve MENOS viajes'::text
    end                                   as estado,

    -- ── El CHECKLIST, que es donde escribe el chofer todos los días ─────────
    ck.km_salida                          as km_salida_checklist,
    ck.km_entrada                         as km_entrada_checklist,
    ck.km_entrada - ck.km_salida          as km_checklist,
    ck.conductor                          as chofer_checklist,
    round((ck.km_entrada - ck.km_salida)::numeric - d.km_gps, 2) as dif_km_checklist,
    case
        when ck.cam is null then 'sin checklist'::text
        when ck.km_salida is null or ck.km_entrada is null then 'día sin cerrar'::text
        when ck.km_entrada < ck.km_salida then 'IMPOSIBLE: llegó con menos km'::text
        when d.km_gps is null or d.km_gps <= 0 then 'sin km de GPS'::text
        when coalesce(d.puntos, 0) < 200 or coalesce(d.hueco_max_min, 0) > 45 then 'rastreo no concluyente'::text
        -- ⛔ El GPS que se prendió a media jornada no puede opinar sobre el día.
        when d.primera_salida is not null and ck.hora_salida is not null
         and extract(epoch from ((d.primera_salida at time zone 'America/Caracas')
                                 - (d.f + ck.hora_salida::time))) / 60 > 120
            then 'rastreo no concluyente (GPS arrancó tarde)'::text
        when abs((ck.km_entrada - ck.km_salida)::numeric - d.km_gps) > 25
         and abs((ck.km_entrada - ck.km_salida)::numeric - d.km_gps) > d.km_gps * 0.25
            then 'km NO cuadran'::text
        else 'km coinciden'::text
    end                                   as estado_km,

    -- ── NUEVO: para que la oficina VEA el porqué, no solo el veredicto ──────
    pl.planillas_del_dia,
    -- Cuántos minutos después de la salida declarada empezó a rastrear el GPS.
    -- Normal: ~18 min. Un número de 3 cifras es un apagón del rastreo.
    case when d.primera_salida is not null and ck.hora_salida is not null
         then round((extract(epoch from ((d.primera_salida at time zone 'America/Caracas')
                                         - (d.f + ck.hora_salida::time))) / 60)::numeric)
    end                                   as gps_arranco_tarde_min

from gps_dia d
-- ⛔ AGRUPADO por unidad y fecha. Sin esto, un camión con dos rutas produce dos
--    filas y cada una compara el total del día contra una parte de los viajes.
left join (
    select cam,
           f,
           -- ⛔ El cast NO es cosmético: `sum()` devuelve bigint y las columnas
           --    `viajes_planilla` y `km_planilla` de la vista ya existen como
           --    integer. `create or replace view` NO deja cambiarle el tipo a una
           --    columna existente —y hace bien, porque ese cambio viaja hasta el
           --    cliente de la pantalla—. Postgres lo frenó con un 42P16.
           sum(t)::integer                as t,
           sum(km)::integer               as km,
           string_agg(distinct ch, ' · ') as ch,
           count(*)                       as planillas_del_dia
      from planillas
     group by cam, f
) pl on pl.cam = d.cam
    and pl.f   = to_char(d.f::timestamp with time zone, 'YYYY-MM-DD'::text)
-- `checklist` NO se agrupa: se midió y tiene cero pares (cam, fecha) repetidos.
left join checklist ck
       on ck.cam   = d.cam
      and ck.fecha = to_char(d.f::timestamp with time zone, 'YYYY-MM-DD'::text);

-- ── COMPROBACIÓN 1: ya no hay filas repetidas (tiene que dar 0) ─────────────
select 'filas repetidas' que, count(*) n from (
  select fecha, cam from v_gps_vs_planilla group by fecha, cam having count(*) > 1) x;

-- ── COMPROBACIÓN 2: el día que cuadraba y salía mal, en UNA fila ────────────
select fecha, cam, vueltas_gps, viajes_planilla, planillas_del_dia, estado
  from v_gps_vs_planilla where cam = 'JAC-B008' and fecha = '2026-09-19';

-- ── COMPROBACIÓN 3: los 8 días de apagón dejan de acusar al chofer ──────────
select fecha, cam, gps_arranco_tarde_min, dif_km_checklist, estado_km
  from v_gps_vs_planilla
 where fecha in ('2026-08-29','2026-09-02') and gps_arranco_tarde_min > 120
 order by fecha, cam;

-- ── COMPROBACIÓN 4: el reparto final ───────────────────────────────────────
select estado, count(*) dias from v_gps_vs_planilla group by estado order by dias desc;
select estado_km, count(*) dias from v_gps_vs_planilla group by estado_km order by dias desc;
