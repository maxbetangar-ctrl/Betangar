-- APP: Betangar (y clones de flota) — base hrkjddehqnzcqwlkklqm
-- FECHA: 2026-08-03
--
-- ⛔ CAUSA RAÍZ: EL PAGO QUE NACE DE UNA FACTURA NO SABÍA DE QUÉ FACTURA NACIÓ.
--
-- Al cargar una factura con "registrar pago", `_registrarPagosDesdeFactura()` inserta un abono
-- por cada orden que la factura cubre. Ese abono quedaba identificado ÚNICAMENTE por texto libre
-- (`obs = 'Pago neto factura F-000304 · orden ...'`). No había columna que lo enlazara.
--
-- Consecuencia: al borrar la factura se revertían las líneas y los montos de la orden —que sí
-- están enlazados— pero los PAGOS quedaban vivos. La orden seguía con saldo cero, así que NO
-- volvía a Cuentas por Pagar, y aparecía como pagada sin ninguna factura que la respalde.
--
-- CASO REAL (Alejandra, 2026-08-03, auditoría):
--   16:07-16:11  se registran 3 deudas de HUMBERTO PACCINI (ATLAS): $20, $12, $72
--   16:24:25     "Factura Bs cargada F-000304 · 3 orden(es)"
--   16:24:25     "Pago CxP (desde factura) · F-000304 · 3 orden(es) · $104.00"   ← los crea
--   16:32:38     "Factura de compra ELIMINADA F-000304"                          ← NO los borra
--   Resultado: $104 en pagos huérfanos y tres órdenes que no volvieron a deber.
--
-- Una factura es un documento que PRODUCE efectos. Si un efecto no queda enlazado al documento
-- que lo causó, no se puede deshacer. Este archivo pone el enlace que faltaba.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) EL ENLACE QUE FALTABA
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.cxp_pagos
  add column if not exists factura_id bigint;

comment on column public.cxp_pagos.factura_id is
  'Factura que originó este abono (null = abono cargado a mano). Sin este enlace, borrar la factura dejaba el pago huérfano y la orden saldada para siempre.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) ENLAZAR LOS QUE YA EXISTEN
-- ─────────────────────────────────────────────────────────────────────────────
-- Se reconocen por el texto que el propio código les puso: 'Pago neto factura <nro> ...'.
-- Solo se enlazan los que apuntan a una factura que TODAVÍA EXISTE; los que apuntan a una
-- factura borrada son justamente los huérfanos, y se tratan en el paso 3.
update public.cxp_pagos p
   set factura_id = f.id
  from public.cxp_facturas f
 where p.factura_id is null
   and coalesce(f.nro_factura,'') <> ''
   and p.obs like 'Pago neto factura ' || f.nro_factura || '%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) LIMPIAR LOS HUÉRFANOS QUE DEJÓ EL BUG
-- ─────────────────────────────────────────────────────────────────────────────
-- Un abono que dice "Pago neto factura X" cuando la factura X ya no existe NO es un pago:
-- es el rastro de una factura borrada. Se elimina y la orden vuelve a deber.
--
-- ⚠️ Se respeta lo CONCILIADO CON EL BANCO: si alguien ya lo cruzó con un movimiento real,
-- no se toca — ahí hay plata que sí salió y eso lo decide una persona, no una migración.
create temp table _huerfanos as
  select p.id, p.cxp_id, p.monto_usd, p.obs
    from public.cxp_pagos p
   where p.factura_id is null
     and p.obs like 'Pago neto factura %'
     and coalesce(p.conciliado_banco,false) = false
     and not exists (
       select 1 from public.cxp_facturas f
        where coalesce(f.nro_factura,'') <> ''
          and p.obs like 'Pago neto factura ' || f.nro_factura || '%'
     );

delete from public.cxp_pagos where id in (select id from _huerfanos);

-- Las órdenes que quedaron saldadas por esos pagos vuelven a estar pendientes.
update public.cxp c
   set estado = 'pendiente', fecha_pago = null
 where c.id in (select cxp_id from _huerfanos)
   and coalesce(c.neto_pagar, c.total_usd, c.base_usd, 0)
       - coalesce((select sum(monto_usd) from public.cxp_pagos p where p.cxp_id = c.id), 0) > 0.005;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) QUE NO PUEDA VOLVER A PASAR, AUNQUE EL CÓDIGO SE OLVIDE
-- ─────────────────────────────────────────────────────────────────────────────
-- La app va a borrar los pagos explícitamente y dejarlo en la auditoría. Esta FK es el candado
-- de abajo: si la factura desaparece por cualquier vía (SQL a mano, otra pantalla, un script),
-- sus pagos se van con ella. Nunca más un pago sin factura que lo explique.
alter table public.cxp_pagos
  drop constraint if exists cxp_pagos_factura_id_fkey;
alter table public.cxp_pagos
  add constraint cxp_pagos_factura_id_fkey
  foreign key (factura_id) references public.cxp_facturas(id) on delete cascade;

create index if not exists cxp_pagos_factura_id_idx on public.cxp_pagos(factura_id);

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (correr después)
-- ─────────────────────────────────────────────────────────────────────────────
-- select count(*) filter (where factura_id is not null) as enlazados,
--        count(*) filter (where factura_id is null and obs like 'Pago neto factura %') as huerfanos_restantes,
--        count(*) as total
--   from cxp_pagos;
-- Esperado: huerfanos_restantes = 0 (salvo los conciliados con banco, que se dejan a propósito).
--
-- select c.orden_id, c.estado, c.neto_pagar,
--        coalesce((select sum(monto_usd) from cxp_pagos p where p.cxp_id=c.id),0) as abonado
--   from cxp c where c.prov_nombre like 'HUMBERTO PACCINI%' order by c.orden_id;
-- Esperado: las 3 órdenes del caso ($20, $12, $72) con abonado 0 y estado 'pendiente'.
