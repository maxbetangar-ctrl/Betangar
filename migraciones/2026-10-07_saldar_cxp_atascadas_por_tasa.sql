-- ═══════════════════════════════════════════════════════════════════════════════
-- LAS 5 CUENTAS QUE NO SE SALDABAN — lo reportó Alejandra el 05/10/2026
--
--   «Ayúdame a saldar las cuentas de inconsummca od 114-115 y 126, y por favor
--    explícame por qué no se están saldando en su totalidad»
--   «En cuentas por pagar aún se observa saldo pendiente: inconsummca od 114-115
--    y 126 · mangueras perija od 73-79»
--
-- 🔴 LA CAUSA está arreglada en `app.js` (`_aplicarFacturasACxp`): el margen de TASA
--    se aplicaba solo cuando lo pactado traía el IVA adentro, así que en el caso
--    normal —pactado SIN IVA— cada céntimo de diferencia entre la orden (dólares) y
--    la factura (bolívares) se quedaba como «mercancía que el proveedor todavía no
--    facturó». Deuda que NO EXISTE y que nadie puede pagar.
--
-- ⚠️ PERO EL CÓDIGO NO ARREGLA LAS FILAS VIEJAS: `_aplicarFacturasACxp` solo corre
--    cuando se guarda o se borra una factura. Sin esta migración, las 5 cuentas
--    seguirían mostrando saldo en la pantalla de Alejandra con el bug ya corregido
--    — media corrección es peor que ninguna.
--
-- ✅ LAS DOS FACTURAS ESTÁN PAGADAS AL CÉNTIMO EN BOLÍVARES, que es la moneda en que
--    se pagaron. Medido el 07/10:
--      F-00000339 · MANGUERAS PERIJA  · debido 44.254,39 Bs · pagado 44.254,39 Bs
--      F-0000349  · INCONSUMMCA (ATLAS) · debido 263.085,69 Bs · pagado 263.085,69 Bs
--    El saldo que se veía es el residuo de medir en DÓLARES una deuda que se pagó en
--    BOLÍVARES: US$ 0,71 entre las cinco.
--
-- 📋 LOS VALORES ANTERIORES, para poder volver atrás (orden · neto_pagar · total_usd):
--      OS-2026-0073 · 25,95 → 25,79  ·  28,93 → 28,77   (fecha_pago 2026-09-22)
--      OS-2026-0079 · 25,95 → 25,79  ·  28,93 → 28,77   (fecha_pago 2026-09-22)
--      OS-2026-0114 · 76,50 → 76,39  ·  86,98 → 86,88   (fecha_pago 2026-09-29)
--      OS-2026-0115 · 40,80 → 40,74  ·  46,39 → 46,33   (fecha_pago 2026-09-29)
--      OS-2026-0126 · 153,00 → 152,78 · 173,97 → 173,75 (fecha_pago 2026-09-29)
--    Las cinco pasan de estado 'pendiente' a 'pagada'.
--
-- ⛔ NO ES UN UPDATE A MANO SOBRE 5 IDs: va GUARDADO, y el guardia es el que decide a
--    quién toca. Solo entra una cuenta que cumpla LAS TRES cosas a la vez:
--      1) está 'pendiente',
--      2) lo pagado en BOLÍVARES cubre lo que la factura dice que se debe en bolívares,
--      3) el residuo en dólares cae DENTRO del margen de tasa (1% o medio dólar).
--    Si el residuo es más grande que el margen, es deuda de verdad y NO se toca.
--    Medido antes de escribir: entran exactamente estas 5 y ninguna otra de las 93
--    cuentas con abono.
-- ═══════════════════════════════════════════════════════════════════════════════

with l as (
  select cxp_id,
         round(sum(neto_bs/tasa_val),2)            as neto_fact_usd,
         round(sum((base_bs+iva_bs)/tasa_val),2)   as total_fact_usd,
         round(sum(neto_bs),2)                     as neto_fact_bs
  from public.cxp_factura_lineas group by cxp_id
), pg as (
  select cxp_id,
         round(sum(monto_bs),2)  as pag_bs,
         round(sum(monto_usd),2) as pag_usd,
         max(fecha)              as ult_pago
  from public.cxp_pagos group by cxp_id
)
update public.cxp c
   set neto_pagar = l.neto_fact_usd,
       total_usd  = l.total_fact_usd,
       estado     = 'pagada',
       fecha_pago = pg.ult_pago
  from l, pg
 where l.cxp_id = c.id
   and pg.cxp_id = c.id
   and c.estado = 'pendiente'
   and pg.pag_bs >= l.neto_fact_bs - 0.01
   and (c.neto_pagar - pg.pag_usd) between 0.0051 and greatest(0.5, coalesce(c.base_usd,0)*0.01);
