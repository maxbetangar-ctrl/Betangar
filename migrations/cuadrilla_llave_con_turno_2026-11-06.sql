-- ═══════════════════════════════════════════════════════════════════════════
-- LA CUADRILLA: UNA SOLA LLAVE, Y QUE SEA LA QUE LLEVA TURNO
-- 06/11/2026
--
-- 🔴 QUÉ PASABA. La v62 (04/11) agregó el índice único
--    `(fecha, cam, turno, empleado_id)` para que cada turno tuviera su propia
--    cuadrilla — pero DEJÓ la PRIMARY KEY vieja `(fecha, cam, empleado_id)`.
--    Las dos conviven, y manda la más estricta: **un ayudante no puede estar
--    en la cuadrilla de los dos turnos de la misma unidad**, que es
--    exactamente lo que la v62 venía a permitir.
--
--    Es el mismo defecto a medias que tenía `combustible_mediciones`: se
--    agrega la llave nueva y no se suelta la vieja, así que el arreglo se ve
--    hecho y no lo está. [[norma-correccion-heredada-toca-todas-las-tablas]]
--
-- ⛔ NO SE SUELTA LA PK A SECAS: SE REEMPLAZA. Una tabla sin PRIMARY KEY
--    pierde su `replica identity` por omisión, y con eso la replicación
--    lógica deja de poder identificar una fila en un UPDATE o un DELETE.
--    Soltar y no poner otra habría cambiado algo que nadie estaba mirando.
--
-- ✅ Comprobado ANTES de correr esto:
--    · el único que escribe es `cuadrilla_declarar`, y ya usa
--      `on conflict (fecha, cam, turno, empleado_id)` — o sea que la llave
--      vieja no la nombra nadie;
--    · de 1.738 filas, 0 tienen `turno` en null y 0 chocarían con la llave
--      nueva.
--    (Soltar un índice sin mirar quién lo nombra ya rompió hoy el guardado del
--     chofer. Una vez por día alcanza.)
-- ═══════════════════════════════════════════════════════════════════════════

-- `turno` entra en una PRIMARY KEY, así que no puede admitir null.
alter table cuadrilla_dia alter column turno set not null;

alter table cuadrilla_dia drop constraint cuadrilla_dia_pkey;
alter table cuadrilla_dia add primary key (fecha, cam, turno, empleado_id);

-- Y el índice único que la v62 creó queda redundante: la PK nueva es el mismo
-- juego de columnas. Dos índices iguales es trabajo de más en cada escritura.
drop index if exists cuadrilla_dia_fecha_cam_turno_emp_key;
