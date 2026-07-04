-- ════════════════════════════════════════════════════════════════════════════
-- FIX A1 (auditoría Fable 5, 2026-07-04) — persistir GASTOS FIJOS.
-- Antes GASTOS_FIJOS vivía SOLO en memoria + seed hardcodeado (app.js) → toda alta/edición/borrado
-- se perdía al recargar y la Utilidad Real (que resta egFijos en _totalEgresos) quedaba anclada a
-- costos fijos ficticios. Se crea la tabla, se le da la MISMA RLS por rol que las sensibles (C2),
-- se revoca anon, y se SIEMBRAN los 4 gastos fijos actuales para no perder el dato.
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.gastos_fijos (
  id text primary key,
  nombre text,
  monto numeric default 0,
  tasa text,
  dia integer default 0,
  activo boolean default true,
  created_at timestamptz default now()
);

alter table public.gastos_fijos enable row level security;
revoke all on public.gastos_fijos from anon;
grant select, insert, update, delete on public.gastos_fijos to authenticated;

-- RLS por comando (igual criterio que C2): lectura oficina+null; escritura solo roles que
-- escriben a diario (NO visualizador, NO null).
drop policy if exists btg_rol_lectura on public.gastos_fijos;
drop policy if exists btg_rol_ins on public.gastos_fijos;
drop policy if exists btg_rol_upd on public.gastos_fijos;
drop policy if exists btg_rol_del on public.gastos_fijos;
create policy btg_rol_lectura on public.gastos_fijos for select to authenticated
  using (app_rol() is null or app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh']));
create policy btg_rol_ins on public.gastos_fijos for insert to authenticated
  with check (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));
create policy btg_rol_upd on public.gastos_fijos for update to authenticated
  using (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
  with check (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));
create policy btg_rol_del on public.gastos_fijos for delete to authenticated
  using (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));

-- Sembrar los 4 gastos fijos actuales (idempotente; no pisa si ya existen).
insert into public.gastos_fijos (id,nombre,monto,tasa,dia,activo) values
  ('GF001','Alquiler Galpon',1600,'promedio',5,true),
  ('GF002','Starlink Galpon',35,'binance',2,true),
  ('GF003','Contador',200,'bcvDolar',0,true),
  ('GF004','Seguro Clinica Zulia',0,'bcvEuro',0,true)
on conflict (id) do nothing;

-- VERIFICAR: select id,nombre,monto,tasa from public.gastos_fijos order by id;
