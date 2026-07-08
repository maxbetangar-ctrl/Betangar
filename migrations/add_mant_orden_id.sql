-- ════════════════════════════════════════════════════════════════════════════
-- ÓRDENES DE SERVICIO Fase 2: enlazar el evento de mantenimiento con la orden que lo originó.
-- Al "cerrar" una orden se registra el mantenimiento con orden_id = OS...; la orden pasa a
-- 'en_proceso' (parcial) o 'hecha' (todas sus unidades registradas). Fuente única: mantenimientos.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.mantenimientos add column if not exists orden_id text;
