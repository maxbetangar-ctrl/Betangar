-- ============================================================================
-- Persistencia de PAGOS de nómina (antes vivían solo en memoria → se perdían al recargar
-- y el resumen del sábado leía tablas inexistentes). Correr en Supabase (proyecto
-- hrkjddehqnzcqwlkklqm). Aditivo. La app escribe con cliente AUTENTICADO (igual que el
-- resto de Betangar), por eso las policies son para 'authenticated'.
-- ============================================================================

create table if not exists pagos_nomina (
  id uuid primary key default gen_random_uuid(),
  fecha text, sem text, mes text,
  total_bs numeric, ref text,
  created_at timestamptz default now()
);

-- Lote de pagos al banco (1 fila por empleado). 'periodo' (mes|sem) = clave de IDEMPOTENCIA
-- para no montar el mismo lote dos veces.
create table if not exists pagos_bnc (
  id uuid primary key default gen_random_uuid(),
  periodo text,
  empleado text, cuenta text, banco text, tipo_cuenta text,
  monto_bs numeric, monto_usd numeric, ref text,
  estado text default 'pendiente_autorizacion',
  fecha text, created_at timestamptz default now()
);
create index if not exists idx_pagos_bnc_periodo on pagos_bnc(periodo);

alter table pagos_nomina enable row level security;
alter table pagos_bnc enable row level security;
drop policy if exists pagos_nomina_auth on pagos_nomina;
drop policy if exists pagos_bnc_auth on pagos_bnc;
create policy pagos_nomina_auth on pagos_nomina for all to authenticated using (true) with check (true);
create policy pagos_bnc_auth on pagos_bnc for all to authenticated using (true) with check (true);
