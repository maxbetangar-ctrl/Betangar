-- ============================================================================
-- Persistencia de los MOVIMIENTOS del banco que registra/concilia la app (antes vivían
-- solo en memoria BNC_MOV → se perdían al recargar). Correr en Supabase (hrkjddehqnzcqwlkklqm).
-- Aditivo. La app escribe con cliente AUTENTICADO (igual que el resto de Betangar).
-- (Los movimientos REALES que empuja el banco siguen en bnc_notificaciones; esta tabla es
--  el tracking interno: pagos pendientes de firma, conciliaciones, registros manuales.)
-- ============================================================================
create table if not exists bnc_movimientos (
  id text primary key,                 -- el id que ya usa la app (Date.now()+...)
  fecha text,
  monto numeric,
  tipo text,                           -- credito | debito | pago_nomina_pend | ...
  descripcion text,
  referencia text,
  conciliado boolean default false,
  pendiente_autorizacion boolean default false,
  detalle jsonb,
  created_at timestamptz default now()
);
alter table bnc_movimientos enable row level security;
drop policy if exists bnc_mov_auth on bnc_movimientos;
create policy bnc_mov_auth on bnc_movimientos for all to authenticated using (true) with check (true);
