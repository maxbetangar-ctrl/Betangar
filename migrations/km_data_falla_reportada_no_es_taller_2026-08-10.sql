-- ═══════════════════════════════════════════════════════════════════════════════
-- Una falla REPORTADA no es un camión PARADO
-- 2026-08-10  (segunda pasada del mismo caso; la primera arregló los DÍAS, no el ESTADO)
--
-- Máximo: «pero el 4 está operativo, incluso hoy trabajó… ya se le echó refrigerante
-- y salió a trabajar».
--
-- Y el propio checklist lo prueba, en la misma fila que la manda a taller:
--   09/08  km 16.527 → 16.655 (128 km)  ·  salió 05:42, volvió 13:17  ·  2 viajes
--   10/08  km 16.655 → 16.713  (58 km)  ·  salió 10:24, volvió 14:27  ·  1 viaje
-- Con `estado_vehiculo = 'taller_betangar'` y la observación «está subiendo la temperatura».
--
-- O sea: el chofer marca la falla en el checklist de LLEGADA, DESPUÉS de hacer la ruta.
-- Está REPORTANDO, no declarando el camión fuera de circulación. El dashboard lo leía como
-- «en taller» y le arrancaba el contador de días.
--
-- Es la MISMA decisión que ya estaba tomada para las anomalías críticas (app.js, 2026-07-20):
-- AVISA, NO manda a taller. Solo que el `estado_vehiculo` del chofer se le saltaba encima.
-- Arreglado en `app.js` (`_clRodo` / `estadoDelChecklist` / `_camFallaCritica`) y en
-- `chofer.html` (una falla marcada en la LLEGADA ya no saca la unidad de circulación).
-- La falla NO se pierde: se pinta como «⚠️ Falla pendiente» leyendo ese mismo checklist.
--
-- Esto corrige el DATO que quedó de la pasada anterior.
-- [[estado-unidad-lo-declara-una-persona]] [[norma-la-premisa-antes-de-acusar]]
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

-- ⛔ DOS reglas descartadas antes de esta, las dos por el mismo motivo: no separaban la B004
--    (que sigue trabajando) de la B001 (que se paró de verdad).
--
--    1ª — «rodó en su último checklist». La B001 la cumple: el 10/07 salió, hizo 44 km, volvió
--         a las 15:45 y AHÍ se quedó, un mes sin planillas ni checklists. Ese es el patrón
--         NORMAL de una unidad que se para: trabaja, vuelve y entra al taller. Rodar el día que
--         la declaran fuera no prueba nada.
--
--    2ª — «rodó HOY». Separaba bien… mientras no cambiara el día. Se corrió pasada la
--         medianoche, el último checklist de la B004 pasó a ser de ayer, y la migración
--         **devolvió éxito habiendo cambiado CERO filas**. Una reparación de datos no puede
--         depender del reloj: es de una sola vez y falla CALLADA.
--         [[norma-mirar-la-ultima-corrida-no-la-existencia]]
--
--    Lo que de verdad las separa no es una fecha, es un hecho: **seguir rodando DESPUÉS del
--    día en que la declararon fuera**. La B004 salió el 10/08 estando marcada desde el 09/08;
--    la B001 no tiene un solo día así. No mira el reloj y dice lo mismo hoy que en un mes.
with racha as (   -- primer día de la racha actual fuera de circulación (misma cuenta que la otra migración)
  select cam, min(fecha) as desde
    from (select cam, fecha,
                 case when estado_vehiculo = 'operativo' then 1 else 0 end as op,
                 row_number() over (partition by cam order by fecha desc) as rn
            from checklist) rk
   where op = 0
     and rn < coalesce((select min(rn) from (select cam c2, fecha,
                 case when estado_vehiculo = 'operativo' then 1 else 0 end op2,
                 row_number() over (partition by cam order by fecha desc) rn
            from checklist) x where x.c2 = rk.cam and x.op2 = 1), 999999)
   group by cam
),
rodaron as (
  select distinct c.cam
    from checklist c
    join racha r on r.cam = c.cam
   where c.fecha > r.desde                       -- ⬅️ SIGUIÓ saliendo después de que la marcaran
     and ( coalesce(nullif(c.km_entrada,0), nullif(c.chofer_km_entrada,0), 0)
         > coalesce(nullif(c.km_salida,0),  nullif(c.chofer_km_salida,0),  0)
        or coalesce(trim(c.hora_entrada), '') <> '' )
)
update km_data k
   set estado           = 'operativo',
       estado_desde     = null,
       nota_estado      = '',
       estado_confirmado = false,
       updated_by       = 'fix falla reportada != taller 2026-08-10'
  from rodaron r
 where r.cam = k.cam
   and k.estado is distinct from 'operativo';

commit;

-- ── Qué quedó (esto SÍ se devuelve: una migración que no cambió nada tiene que NOTARSE) ──
-- La versión anterior corrió, devolvió 201 y tocó cero filas sin decirlo. Ahora el resultado
-- de la corrida es esta tabla: si la columna `arreglada` no dice `t` en ninguna, no se hizo nada.
select cam, estado, estado_desde, nota_estado, updated_by,
       (updated_by = 'fix falla reportada != taller 2026-08-10') as arreglada
  from km_data
 where cam like 'JAC-%'
   and (estado is distinct from 'operativo'
        or updated_by = 'fix falla reportada != taller 2026-08-10')
 order by cam;
