-- ════════════════════════════════════════════════════════════════════════════
-- ÓRDENES DE COMPRA + CENTRO DE COSTOS + INVENTARIO (flujo unificado).
-- Una sola "orden" ahora es de SERVICIO o de COMPRA (tipo_orden). Al cerrar una compra
-- se define el DESTINO por la regla universal: ¿se usa/instala YA (gasto directo en la
-- unidad o en el patio/oficina) o QUEDA en existencia (entra a inventario)?
--
-- Modelo del dinero (sin doble conteo):
--   • CAJA/CxP  → una sola vez AL COMPRAR (crédito = cxp con orden_id).
--   • COSTO DE LA UNIDAD → cuando la pieza se INSTALA (mantenimientos.costo_usd).
--   • VALOR EN ALMACÉN → el puente (inventario.stock × precio) mientras es reserva.
-- El repuesto de reserva que se instala meses después: fila de mantenimientos con
-- origen='inventario' (activo→gasto, NO plata nueva) y precio = último precio de compra.
--
-- Trazabilidad: orden → inv_movimientos(Entrada, orden_id) → inv_movimientos(Uso, mant_id)
--   → mantenimientos. Comprado → (en stock) → instalado en B0XX el día X.
--
-- Migración PURAMENTE ADITIVA: solo agrega columnas/índices. No toca RLS ni datos
-- existentes. Correr en Supabase SQL Editor (proyecto hrkjddehqnzcqwlkklqm).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Tipo de orden: servicio (default, órdenes viejas quedan así) | compra
alter table public.ordenes_servicio add column if not exists tipo_orden text default 'servicio';

-- 2) Mantenimientos: centro de costo (solo significativo cuando cam='PATIO': oficina|herramientas|otros),
--    origen (='inventario' cuando la fila nace de un despacho de stock: activo→gasto, no plata nueva),
--    garantia_hasta (fecha límite de garantía de la pieza → alimenta la alerta existente).
alter table public.mantenimientos add column if not exists centro_costo   text default '';
alter table public.mantenimientos add column if not exists origen         text default '';
alter table public.mantenimientos add column if not exists garantia_hasta date;

-- 3) Movimientos de inventario: enlace a la orden que originó la Entrada, al mantenimiento
--    que generó el Uso (instalación), y la garantía de la pieza que entró a stock.
alter table public.inv_movimientos add column if not exists orden_id       text;
alter table public.inv_movimientos add column if not exists mant_id        text;
alter table public.inv_movimientos add column if not exists garantia_hasta date;

-- 4) Cuentas por pagar: enlace a la orden que la originó (mismo patrón que mantenimientos.orden_id).
alter table public.cxp add column if not exists orden_id text default '';

-- 5) Índices para los cruces del flujo (cierre de orden, reporte centro de costos, trazabilidad).
create index if not exists idx_cxp_orden           on public.cxp(orden_id);
create index if not exists idx_invmov_orden         on public.inv_movimientos(orden_id);
create index if not exists idx_invmov_mant          on public.inv_movimientos(mant_id);
create index if not exists idx_mant_orden           on public.mantenimientos(orden_id);
create index if not exists idx_ordserv_tipo         on public.ordenes_servicio(tipo_orden);
