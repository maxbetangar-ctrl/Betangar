-- ============================================================================
-- Betangar · el movimiento del banco trae SU PROPIO identificador
-- 2026-08-09.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN
-- Hasta hoy se creía que la API del BNC «no trae id de transacción ni saldo por
-- movimiento», y por eso se estuvo diseñando una llave compuesta por
-- fecha + monto + referencia. Esa llave se probó contra los 2.235 movimientos
-- reales y FUNDÍA 307 filas, perdiendo Bs 9.811.821,57 en silencio: un pago de
-- nómina en lote son decenas de filas con la MISMA fecha, monto y referencia,
-- una por trabajador.
--
-- La API sí los trae. Cada movimiento viene con:
--   · ControlNumber   → identificador propio del banco
--   · PreviousBalance → el saldo ANTES de ese movimiento
-- Verificado sobre 2.412 movimientos del 23/03 al 08/08 en las 4 cuentas:
-- 2.412 ControlNumber distintos, ninguno vacío, ninguno repetido ni siquiera
-- entre cuentas. El caso que rompía todo —30/04, 13 filas de Bs 2.435,60
-- idénticas— vuelve del banco con 13 ControlNumber distintos.
--
-- ⚠️ `control_number` NULL NO es un error: significa «este movimiento NO vino
-- del banco». Los hay legítimos —los que genera la propia app, como el
-- «Pago Alcaldia Fact.000638»— y por eso el índice único es PARCIAL.
-- ============================================================================

alter table bnc_movimientos add column if not exists control_number text;
alter table bnc_movimientos add column if not exists cuenta         text;
alter table bnc_movimientos add column if not exists saldo_anterior numeric;

comment on column bnc_movimientos.control_number is
  'Identificador que da el BNC (campo ControlNumber). ÚNICO. NULL = el movimiento no vino del banco (lo generó la app).';
comment on column bnc_movimientos.cuenta is
  'Cuenta del BNC a la que pertenece. Hay 4; el estado de cuenta en Excel cubría solo la principal (…012653).';
comment on column bnc_movimientos.saldo_anterior is
  'PreviousBalance del BNC: el saldo ANTES de este movimiento. Encadena exacto y es lo único que distingue dos filas idénticas de un lote de nómina.';

-- ÚNICO y NO PARCIAL, a propósito.
-- La primera versión de esta migración lo creó como parcial
-- (`where control_number is not null`), que parecía lo prolijo. Se probó y NO
-- SIRVE: `supabase-js` manda `ON CONFLICT (control_number)` sin repetir el
-- `where`, y Postgres entonces no puede inferir un índice parcial:
--     42P10: there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
-- El upsert habría fallado SIEMPRE, y como el código cae a la cola offline
-- cuando la escritura falla, no se habría visto: la pantalla mostraría los
-- movimientos y nadie sabría que no se guarda ninguno.
-- No hace falta que sea parcial: en Postgres un índice único admite CUANTOS
-- NULL haga falta (dos NULL no se consideran iguales), así que los movimientos
-- propios de la app —que no tienen número de control— conviven sin problema.
drop index if exists ux_bnc_mov_control_number;
create unique index if not exists ux_bnc_mov_control_number
  on bnc_movimientos (control_number);

create index if not exists ix_bnc_mov_cuenta on bnc_movimientos (cuenta);
create index if not exists ix_bnc_mov_fecha  on bnc_movimientos (fecha);
