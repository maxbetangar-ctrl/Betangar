-- ═══════════════════════════════════════════════════════════════════════════
-- EL TURNO ENTRA EN LA LLAVE DE LAS MEDICIONES DE COMBUSTIBLE
-- 06/11/2026
--
-- 🔴 QUÉ ESTABA PASANDO. `combustible_mediciones` tenía la llave única
--    `(vehiculo_id, fecha, momento)` — SIN turno. Desde que Betangar trabaja
--    con dos turnos (04/11/2026), el segundo chofer que mide NO agrega su
--    lectura: PISA la del primero.
--
--    Medido el 06/11 en JAC-B009:
--      06:20  JORWIN (diurno)       registra salida  37 cm   ← se perdió
--      luego  JOSE ALFREDO (noct.)  registra salida  34 cm   ← quedó esta
--      16:10  JORWIN (diurno)       registra llegada 34 cm
--    La auditoría hace 34 − 34 = 0 litros. No es un error de cálculo: el dato
--    de salida del turno diurno YA NO EXISTE.
--
--    Y no fue un caso suelto. Ese día hubo EXACTAMENTE 2 unidades con dos
--    turnos (B004 y B009) y EXACTAMENTE esas 2 tienen la salida marcada como
--    pisada. Toda unidad que hace dos turnos pierde la lectura del primero.
--
-- ⛔ POR QUÉ NO ALCANZABA CON CORREGIR LA FILA. Con un solo casillero para dos
--    lecturas, poner el 37 del diurno borra el 34 del nocturno: sólo cambia
--    cuál de los dos turnos queda mal. [[norma-arreglar-el-mecanismo-no-el-caso]]
--
-- ⛔ Y ES EL MISMO ARREGLO QUE YA SE LE HIZO AL CHECKLIST EL 04/11. El turno
--    entró en la llave allá y no acá: media corrección. [[norma-correccion-heredada-toca-todas-las-tablas]]
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · La columna ────────────────────────────────────────────────────────────
-- `default 'diurno'` y NOT NULL a propósito: en un índice único los NULL son
-- distintos entre sí, así que una fila sin turno volvería a dejar entrar
-- duplicados — justo lo que se viene a cerrar.
alter table combustible_mediciones
  add column if not exists turno text not null default 'diurno';

comment on column combustible_mediciones.turno is
  'Turno al que pertenece la medición (diurno/nocturno). Entra en la llave única: sin esto el segundo turno pisa la lectura del primero.';

-- 2 · Rellenar el turno de lo que ya estaba ─────────────────────────────────
-- ⛔ NO SE ADIVINA. Se deduce de quién la registró, cruzando contra el
--    checklist de esa unidad y ese día. Medido antes de correr esto:
--      2.695 de 2.711 salen por el NOMBRE del chofer
--          2 más porque ese día hubo un solo turno
--         14 quedan sin cruce: son del 19 y 20/06/2026, días SIN checklist
--            cargado y muy anteriores al 04/11 — o sea que sólo había turno
--            diurno. Para esas, `diurno` es un hecho, no una suposición.
update combustible_mediciones m
   set turno = c.turno
  from checklist c
 where c.cam = m.vehiculo_id
   and c.fecha::date = m.fecha::date
   and upper(trim(c.conductor)) = upper(trim(m.registrado_por))
   and c.turno is not null
   and m.turno = 'diurno';

-- Las que no calzaron por nombre pero ese día tuvieron UN solo turno.
update combustible_mediciones m
   set turno = x.turno
  from (select c.cam, c.fecha::date f, min(c.turno) turno
          from checklist c
         group by c.cam, c.fecha::date
        having count(distinct c.turno) = 1) x
 where x.cam = m.vehiculo_id
   and x.f = m.fecha::date
   and m.turno = 'diurno'
   and x.turno <> 'diurno';

-- 3 · La llave nueva ────────────────────────────────────────────────────────
-- Se crea ANTES de soltar la vieja: agregarle una columna a la llave sólo
-- puede hacerla MÁS única, así que no hay forma de que choque.
create unique index if not exists uq_comb_med_unidad_fecha_momento_turno
  on combustible_mediciones (vehiculo_id, fecha, momento, turno);

-- 4 · Soltar la vieja ─────────────────────────────────────────────────────
-- Mientras `uq_comb_med_unidad_fecha_momento` exista, sigue exigiendo UNA sola
-- lectura por unidad/fecha/momento y el segundo turno NO puede guardar. Se
-- suelta despues de crear la nueva, nunca antes: entre una y otra la tabla
-- quedaria sin llave.
drop index if exists uq_comb_med_unidad_fecha_momento;

-- Comprobado despues de correr esto (06/11/2026):
--   turno: 2.709 diurno + 2 nocturno   (las 2 son justamente las que pisaban)
--   indices unicos: queda solo uq_comb_med_unidad_fecha_momento_turno
