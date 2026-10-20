-- ============================================================================
-- UNA FACTURA PUEDE RECIBIR VARIOS PAGOS — se levanta el UNIQUE(fact)
-- 2026-10-20. Máximo: «quita el unique para que acepte los pagos parciales».
--
-- QUÉ ESTABA MAL
-- `abonos` tenía UNIQUE sobre `fact`: una factura admitía UN SOLO abono. Pero la
-- Alcaldía paga en partes, así que el segundo pago NO SE PODÍA REGISTRAR — ni a
-- mano ni por ninguna vía. Se vio el 20/10/2026 conciliando contra el banco:
--   factura 000646 … el banco cobró US$ 39.320 y había US$ 20.597 registrados
--   factura 000647 … el banco cobró US$ 22.927 y había US$ 12.041 registrados
-- Esa mitad faltante no era descuido de nadie: la tabla la rechazaba.
--
-- ⛔ ERAN DOS ÍNDICES, NO UNO. `abonos_fact_key` (la constraint) y
--    `abonos_fact_unique` (un índice suelto, creado aparte). Quitar solo el
--    primero deja el bloqueo exactamente igual, y el error diría otra cosa.
--    [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ⛔ PERO NO SE PUEDE QUEDAR SIN NINGUNA LLAVE. Tres lugares del código hacen
--    `upsert(..., {onConflict:'fact'})`, incluidos DOS IMPORTADORES masivos. Sin
--    una restricción única esos upserts fallan, y si se los pasa a INSERT a
--    secas, volver a correr un importador DUPLICA todos los abonos. Lo que
--    protegía contra eso era justamente el unique que se está quitando.
--
-- LA LLAVE NUEVA: UNIQUE (fact, ref)
-- Cada pago de una factura trae su propia referencia bancaria, así que el par
-- identifica el pago. Permite los pagos parciales Y sigue frenando el
-- re-importe. Verificado antes de crearla: hoy no hay ni un par (fact, ref)
-- repetido en las 31 filas.
--
-- ⚠️ EFECTO BUSCADO: dos pagos de la misma factura SIN referencia chocan. Está
--    bien que choque — un cobro sin referencia no se puede conciliar contra el
--    banco de ninguna manera, así que el sistema pide el dato en vez de aceptar
--    dos filas que después nadie puede distinguir. (14 de 31 abonos viejos no
--    tienen `ref`; esos no se tocan, y mientras sean uno por factura conviven.)
-- ============================================================================

-- 1 · Fuera las dos llaves viejas. LAS DOS.
alter table abonos drop constraint if exists abonos_fact_key;
drop index if exists abonos_fact_unique;

-- 2 · La llave nueva: el PAGO, no la factura.
-- ⛔ SOBRE LAS COLUMNAS, NO SOBRE UNA EXPRESIÓN. El primer intento fue
--    `(fact, coalesce(ref,''))` y habría sido inútil: el upsert no lo hace SQL, lo
--    hace PostgREST desde el navegador con `on_conflict=fact,ref`, y eso exige un
--    índice sobre las COLUMNAS. Un índice sobre una expresión lo deja sin llave y
--    el guardado de abonos falla. [[norma-probar-el-camino-no-la-pieza]]
-- ⚠️ `ref` nunca es NULL (su default es '' y hoy son 14 en vacío, 0 en NULL), así
--    que el índice simple protege de verdad: con NULL, Postgres los dejaría pasar
--    todos porque NULL nunca es igual a NULL.
alter table abonos alter column ref set default '';
update abonos set ref='' where ref is null;
alter table abonos alter column ref set not null;
-- ⚠️ Y VA CON `drop` DELANTE: `create ... if not exists` NO cambia un índice que ya
--    existe con ese nombre. La primera corrida de esta migración lo dejó sobre la
--    expresión y el `if not exists` se calló. Un «ya está» no es «está bien».
drop index if exists abonos_fact_ref_unique;
create unique index abonos_fact_ref_unique on abonos (fact, ref);

comment on index abonos_fact_ref_unique is
  'Identifica un PAGO, no una factura: una factura puede recibir varios pagos y cada uno trae su referencia bancaria. Reemplaza al UNIQUE(fact), que impedía registrar el segundo pago de una factura — la Alcaldía paga en partes.';

comment on column abonos.fact is
  'Número de factura. ⛔ NO es única: una factura puede tener VARIOS abonos (pagos parciales). Lo que identifica un pago es (fact, ref).';
comment on column abonos.ref is
  'Referencia bancaria del pago. Es lo que distingue un pago de otro de la MISMA factura; sin ella no se puede conciliar contra el estado de cuenta.';
