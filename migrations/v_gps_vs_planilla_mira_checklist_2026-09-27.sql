-- ═══════════════════════════════════════════════════════════════════════════════
-- QUE LA VISTA MIRE EL CHECKLIST — no solo `planillas`
--
-- ⛔ POR QUÉ, con el caso que lo destapó. El 26/09/2026 el chofer Jorwin Faria no
--    podía cerrar el JAC-B009: la salida (22.521) era mayor que la llegada (22.385).
--    El número malo se había tecleado el 25 AL LLEGAR —22.521 en vez de 22.251, dos
--    dígitos cambiados de lugar— y dejaba al 25/09 con una jornada de 423 km cuando
--    los seis días previos iban de 95 a 175.
--
--    **La base YA SABÍA que eso era falso.** `gps_dia` tenía escrito que ese día el
--    camión recorrió 155,83 km, con 655 puntos y 8 minutos de hueco máximo: una
--    medición buena. Pero esta vista cruzaba ÚNICAMENTE contra `planillas`, que no
--    tenía fila, así que mostró «sin planilla» y `km_planilla: null`.
--
-- 📌 «Sin planilla» se lee como «no hay nada que comparar». Y sí había: había 270 km
--    fantasma, a una columna de distancia, en la tabla donde el chofer escribe todos
--    los días. [[norma-falta-de-dato-no-es-un-dato]]
--
-- ⚠️ Esos km no son un detalle de tablero: entran en el consumo por kilómetro, en los
--    intervalos de mantenimiento y en el COSTO POR UNIDAD, que es el número principal
--    del informe mensual del dueño.
--    [[norma-costo-por-unidad-es-el-numero-principal]]
--
-- ── QUÉ NO SE TOCA, Y POR QUÉ ────────────────────────────────────────────────
-- ⛔ `estado` queda EXACTAMENTE IGUAL, con los mismos textos. El `app.js` de Betangar
--    (`renderGpsVsPlanilla`) filtra por sus valores literales —'GPS ve MÁS viajes',
--    'GPS ve MENOS viajes'— para armar los contadores. Cambiarlos le rompe la pantalla
--    en silencio: seguiría pintando, con todos los contadores en cero.
--    Las columnas nuevas van AL FINAL; la pantalla hace `select('*')`, así que las
--    recibe sin enterarse y sin romperse.
--
-- ── EL UMBRAL SE MIDIÓ, NO SE INVENTÓ ────────────────────────────────────────
-- Sobre los 222 días con rastreo bueno (>=200 puntos, hueco <=45 min) que ya tienen
-- checklist cerrado:
--
--   diferencia entre km del checklist y km del GPS
--   mediana  2,0 %      p90  15,0 %      p95  44,4 %      peor  188,3 %
--
--   cuántos días saltaría cada umbral:
--     >15 % y >15 km  →  23 de 222  (10,4 %)
--     >25 % y >25 km  →  17 de 222  ( 7,7 %)   ← el elegido
--     >40 % y >30 km  →  12 de 222  ( 5,4 %)
--
-- Se eligió **>25 % Y >25 km** — uno de cada trece días, revisable— y atrapa de sobra
-- el 171 % del 25/09. Se piden LAS DOS condiciones a propósito: solo el porcentaje
-- haría saltar un día corto (20 km medidos, 26 reales es 30 % y no es nada), y solo
-- los km absolutos dejarían pasar un desvío grande en un día largo.
-- ⛔ Un aviso que salta todos los días no avisa de nada.
--
-- ── LO QUE NO ACUSA ──────────────────────────────────────────────────────────
-- ⛔ Un día SIN CERRAR no es un error: es un día sin cerrar. Sale como tal y no como
--    diferencia. Es justo el estado en que está hoy el B009 del 26/09.
-- ⛔ Un día MAL RASTREADO no puede opinar. Se reusa la misma guarda que ya usa
--    `estado` (puntos < 200 o hueco > 45 min): sin eso se acusa a un chofer con un
--    día que no se midió bien. El comentario original de `app.js` lo dice: «acusar a
--    un chofer con un día mal medido es acusar a un inocente con cara de dato
--    objetivo».
-- ⛔ `km_gps` en 0 o nulo tampoco opina: no hay contra qué comparar.
--
-- ── DETALLE DEL JOIN ─────────────────────────────────────────────────────────
-- `checklist.fecha` es TEXT, igual que `planillas.f`, y `gps_dia.f` es DATE. Por eso
-- el `to_char(...,'YYYY-MM-DD')` — es el mismo patrón que la vista ya usaba para
-- `planillas`, no una licencia nueva. (Que esas dos columnas sean texto y no fecha es
-- deuda aparte; arreglarlo acá sería cambiar dos tablas vivas de paso.)
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
    -- ⛔ SIN CAMBIOS. La pantalla filtra por estos textos.
    case
        when pl.t is null then 'sin planilla'::text
        when d.vueltas is null then 'sin medir'::text
        when d.vueltas = pl.t then 'coincide'::text
        when coalesce(d.puntos, 0) < 200 or coalesce(d.hueco_max_min, 0) > 45 then 'diferencia NO concluyente'::text
        when d.vueltas > pl.t then 'GPS ve MÁS viajes'::text
        else 'GPS ve MENOS viajes'::text
    end                                   as estado,

    -- ── NUEVO: lo que dice el CHECKLIST, que es donde escribe el chofer ──────
    ck.km_salida                          as km_salida_checklist,
    ck.km_entrada                         as km_entrada_checklist,
    ck.km_entrada - ck.km_salida          as km_checklist,
    ck.conductor                          as chofer_checklist,
    -- Positivo = el checklist dice MÁS km que el GPS.
    round((ck.km_entrada - ck.km_salida)::numeric - d.km_gps, 2) as dif_km_checklist,
    case
        when ck.cam is null then 'sin checklist'::text
        when ck.km_salida is null or ck.km_entrada is null then 'día sin cerrar'::text
        -- Imposible: llegó con menos kilómetros de los que salió. Hoy da 0 casos
        -- porque la app lo frena al guardar; esto es la red para lo que entre por
        -- otro lado (una carga directa, un arreglo a mano, una importación).
        when ck.km_entrada < ck.km_salida then 'IMPOSIBLE: llegó con menos km'::text
        when d.km_gps is null or d.km_gps <= 0 then 'sin km de GPS'::text
        when coalesce(d.puntos, 0) < 200 or coalesce(d.hueco_max_min, 0) > 45 then 'rastreo no concluyente'::text
        when abs((ck.km_entrada - ck.km_salida)::numeric - d.km_gps) > 25
         and abs((ck.km_entrada - ck.km_salida)::numeric - d.km_gps) > d.km_gps * 0.25
            then 'km NO cuadran'::text
        else 'km coinciden'::text
    end                                   as estado_km

from gps_dia d
left join planillas pl
       on pl.cam = d.cam
      and pl.f   = to_char(d.f::timestamp with time zone, 'YYYY-MM-DD'::text)
left join checklist ck
       on ck.cam   = d.cam
      and ck.fecha = to_char(d.f::timestamp with time zone, 'YYYY-MM-DD'::text);

-- ── COMPROBACIÓN: el caso que lo destapó tiene que salir marcado ─────────────
-- Antes de correr el arreglo de los km de Jorwin, el 25/09 debe dar 'km NO cuadran'
-- con 423 contra 155,83. Después del arreglo debe pasar a 'km coinciden' con 153.
-- Y el 26/09 debe decir 'día sin cerrar', NO un error.
select fecha, cam, km_gps, km_checklist, dif_km_checklist, estado, estado_km
  from v_gps_vs_planilla
 where cam = 'JAC-B009' and fecha between '2026-09-23' and '2026-09-26'
 order by fecha;

-- ── Y cuántos días quedan marcados en toda la flota ─────────────────────────
select estado_km, count(*) dias
  from v_gps_vs_planilla
 group by estado_km
 order by dias desc;
