-- ════════════════════════════════════════════════════════════════════════════
-- CORREGIR UNA SURTIDA MAL CARGADA POR EL CHOFER   (2026-07-25)
-- Máximo: "debería poder ser editable errores como esos del chofer para que no me estén
-- llamando a mí". Corregir NO pide token (si lo pidiera, lo llamarían igual): lo hace
-- quien tenga el permiso `corregir-chofer`. A cambio, la corrección DEJA RASTRO.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.surtidas add column if not exists corregido_por text;
alter table public.surtidas add column if not exists corregido_at timestamptz;
alter table public.surtidas add column if not exists valor_anterior jsonb;
comment on column public.surtidas.valor_anterior is
  'Lo que decía la fila antes de la corrección + el motivo. Se apila en .historial[].';

-- Y `surtidas_listar` tiene que DEVOLVER esas columnas: si no, la pantalla no puede avisar
-- que una surtida fue corregida y el número cambia sin que nadie se entere.
-- (En Betangar la lista es un select('*') directo y no hace falta tocar nada.)
