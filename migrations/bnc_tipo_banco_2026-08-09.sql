-- ============================================================================
-- Betangar · EL `Type` DEL BANCO — el campo que NO escribe una persona
-- 2026-08-09.
--
-- ⛔ EL ERROR, Y ES GRANDE
-- Bs 5.174.995 de PAGOS DE IMPUESTOS quedaron clasificados como «traspaso entre
-- cuentas propias» y por lo tanto FUERA DEL GASTO. Son 35 movimientos que salen
-- de la cuenta 2 y no vuelven.
--
-- La causa: la regla de traspaso mira el CONCEPTO, y el concepto de esos
-- movimientos viene HEREDADO y equivocado — dice «TRANSFERENCIA RECIBIDA DEL
-- BCO. NACIONAL DE CREDITO A NOMBRE DE: J-295661070…», que es texto de un
-- INGRESO, en movimientos que son EGRESOS. Como ese texto menciona la cuenta
-- principal, la regla los tomó por traspasos.
--
-- Lo que dice el campo que NO escribe nadie:
--     Type = 'PAGO DE IMPUESTOS BNCNET CARGO'   ·   Code = 425
--     ReferenceB = 99030, 99035, 99044, 99074  ← las FORMAS del SENIAT
--
-- ⚠️ Y ESTO CONFIRMA A MÁXIMO Y ME DESMIENTE A MÍ. Él dijo temprano: «los
-- impuestos se pagan de la 2 casi todos». Yo lo "verifiqué" mirando el Concept,
-- no encontré ningún pago al SENIAT en esa cuenta y concluí que no los pagaba.
-- El dato del negocio era correcto; mi comprobación miraba el campo equivocado.
-- [[norma-auditoria-precondicion-antes-de-acusar]]
--
-- REGLA QUE QUEDA: cuando el banco da un campo estructurado (Type, Code), ese
-- manda sobre el texto libre. El texto se hereda, se copia y se equivoca; el
-- código de operación lo pone el sistema del banco.
-- ============================================================================

alter table bnc_movimientos add column if not exists tipo_banco   text;
alter table bnc_movimientos add column if not exists codigo_banco text;

comment on column bnc_movimientos.tipo_banco is
  'El campo `Type` del BNC: qué operación es, según el propio banco. Manda sobre el concepto, que viene heredado en algunos movimientos y miente (un EGRESO con texto de INGRESO).';
comment on column bnc_movimientos.codigo_banco is
  'El campo `Code` del BNC. 425 = pago de impuestos.';

create index if not exists ix_bnc_mov_tipo_banco on bnc_movimientos (tipo_banco);
