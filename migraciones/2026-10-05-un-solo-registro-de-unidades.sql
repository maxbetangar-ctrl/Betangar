-- ═══════════════════════════════════════════════════════════════════════════
-- UN SOLO REGISTRO DE UNIDADES — 2026-10-05
--
-- El producto tenia DOS registros de la misma cosa:
--   · `unidad_config` = registro MAESTRO. Ficha completa (28 columnas: seriales,
--     foto, capacidad del tanque, chofer, odometro...). ES el que se usa:
--     23 unidades en FLOTILLA, 26 en Tony Gas, 13 en Betangar, 3 en el demo.
--   · `unidades` = el de Operacion/Contratos. 8 columnas, y 7 ya estan en
--     `unidad_config`. **CERO filas en las 5 bases**: nadie lo uso nunca.
--
-- Esa duplicacion ya costo: el 04/10 se midio `unidades` y se reporto que Tony
-- Gas tenia CERO unidades, teniendo 26 y usandolas todos los dias.
--
-- La unica columna PROPIA de `unidades` es `contrato_id` (el "contrato habitual"
-- de la unidad). Se muda al maestro y el segundo registro deja de existir.
--
-- ⛔ ADITIVA Y SOLA: esto NO borra `unidades` ni toca una fila. Primero la
--    columna en TODAS las bases, despues el codigo. Al reves, el codigo nuevo
--    escribe en una columna que no esta y falla en el cliente.
-- ⛔ NO se dropea `unidades`: tiene 0 filas, pero dropear es irreversible y lo
--    decide Maximo. Mientras no la lea nadie, una tabla vacia no estorba.
-- ═══════════════════════════════════════════════════════════════════════════
alter table unidad_config add column if not exists contrato_id text;

comment on column unidad_config.contrato_id is
  'Contrato habitual de la unidad (opcional). Vino de la tabla `unidades`, que era un SEGUNDO registro de unidades con 0 filas en las 5 bases. Una unidad puede trabajarle a varios clientes: el contrato real se elige en cada operacion. 2026-10-05.';
