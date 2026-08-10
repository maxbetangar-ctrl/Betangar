-- ═══════════════════════════════════════════════════════════════════════════
-- CONCILIACIÓN DE EGRESOS: una sola respuesta a «¿este pago está cruzado?»
-- Betangar — hrkjddehqnzcqwlkklqm — 2026-08-10
-- ═══════════════════════════════════════════════════════════════════════════
-- El problema, medido: la pregunta tenía DOS respuestas y no coincidían.
--
--   `cxp_pagos.conciliado_banco`   la escribe SOLA la pantalla Conciliación  → 9 en true
--   `bnc_movimientos.conciliado`   la escribe A MANO el botón «Conciliar»    → 1 en true
--
-- Ninguna escribía la otra. Consecuencia: 2.418 movimientos seguían ofreciendo
-- el botón «Conciliar», incluidos los de los 9 pagos ya cruzados — se podía
-- conciliar dos veces lo mismo desde la otra pantalla, sin aviso.
--
-- Es el mismo defecto que el de los cobros de factura del 09/08, del otro lado
-- del libro: allá eran ingresos (`cobros_factura` vs `bnc_movimientos.factura`),
-- acá son egresos. La solución es la misma y por el mismo motivo: el movimiento
-- del banco lleva el ENLACE a lo que paga, y `conciliado` deja de ser una
-- opinión suelta para pasar a ser consecuencia de ese enlace.
--
-- ⚠️ Lo que este archivo NO hace: adivinar. De los 9 pagos, 6 se enlazan sin
-- ambigüedad (un único débito con su monto exacto en ±2 días). Los otros 3 NO
-- tienen NINGÚN débito que les corresponda en la tabla y se dejan como están,
-- reportados. Ver la nota al final.

begin;

-- ── 1) EL ENLACE ───────────────────────────────────────────────────────────
-- Simétrico a `factura`/`pata`, que ya cumplen este papel para los ingresos.
alter table public.bnc_movimientos
  add column if not exists cxp_pago_id bigint
    references public.cxp_pagos(id) on delete set null;

comment on column public.bnc_movimientos.cxp_pago_id is
  'Pago a proveedor que este débito liquida. Lo sella la pantalla Conciliación en el mismo '
  'momento que marca cxp_pagos.conciliado_banco: las dos puntas se escriben juntas o no se '
  'escribe ninguna. Antes solo se marcaba el pago y el movimiento quedaba diciendo "sin conciliar".';

-- ⛔ UN PAGO NO PUEDE LIQUIDARSE CON DOS MOVIMIENTOS DEL BANCO.
-- Sin esto, dos corridas de la pantalla contra rangos distintos podrían sellar
-- el mismo pago en dos débitos y el egreso se contaría dos veces.
create unique index if not exists idx_bnc_mov_cxp_pago_unico
  on public.bnc_movimientos(cxp_pago_id) where cxp_pago_id is not null;

create index if not exists idx_bnc_mov_cxp_pago on public.bnc_movimientos(cxp_pago_id);

-- ── 2) ENLAZAR LO QUE YA ESTÁ CRUZADO, SOLO SI ES INEQUÍVOCO ───────────────
-- Criterio: el pago está marcado como conciliado Y existe EXACTAMENTE UN débito
-- con su mismo monto en ±2 días. Un solo candidato o no se toca.
-- (La referencia NO sirve para esto: la pantalla la copió de la API en vivo y
-- 8 de esos 9 movimientos se guardaron desde el Excel, con otra referencia.)
with candidatos as (
  select p.id as pago_id, m.id as mov_id, count(*) over (partition by p.id) as n
    from public.cxp_pagos p
    join public.bnc_movimientos m
      on m.tipo = 'debito'
     and round(m.monto, 2) = round(p.monto_bs, 2)
     and m.fecha between (p.fecha::date - 2)::text and (p.fecha::date + 2)::text
   where p.conciliado_banco
     and m.cxp_pago_id is null
)
update public.bnc_movimientos m
   set cxp_pago_id = c.pago_id,
       conciliado  = true
  from candidatos c
 where m.id = c.mov_id and c.n = 1;

-- ── 3) COMPROBAR ───────────────────────────────────────────────────────────
do $$
declare enlazados int; sueltos int; dobles int;
begin
  select count(*) into enlazados from public.bnc_movimientos where cxp_pago_id is not null;

  -- Pagos marcados como conciliados que quedaron SIN movimiento enlazado.
  select count(*) into sueltos
    from public.cxp_pagos p
   where p.conciliado_banco
     and not exists (select 1 from public.bnc_movimientos m where m.cxp_pago_id = p.id);

  -- Ningún movimiento enlazado puede quedar diciendo "sin conciliar".
  select count(*) into dobles
    from public.bnc_movimientos where cxp_pago_id is not null and not conciliado;
  if dobles > 0 then
    raise exception 'Hay % movimientos enlazados a un pago y marcados como NO conciliados.', dobles;
  end if;

  raise notice 'Enlazados: % · pagos conciliados sin movimiento que los respalde: %', enlazados, sueltos;
end $$;

commit;

-- ── LO QUE QUEDA A LA VISTA, Y NO SE INVENTA ───────────────────────────────
-- 3 pagos siguen marcados `conciliado_banco = true` sin ningún débito que les
-- corresponda en `bnc_movimientos` (±2 días, monto exacto):
--
--     id  6 · Bs  44.308,19 · 14/07/2026
--     id  7 · Bs  44.928,00 · 22/07/2026
--     id 10 · Bs  20.000,00 · 16/07/2026
--
-- O el movimiento nunca se guardó (la pantalla concilia contra la API en vivo y
-- solo 197 de los 2.431 movimientos guardados vienen de la API; el resto entró
-- por el Excel), o el cruce que los marcó estaba mal. Desde la base no se puede
-- distinguir, así que NO se tocan: se reportan.
-- Comprobarlo es mirar el estado de cuenta de esos tres días.
