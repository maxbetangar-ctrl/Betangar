-- ═══════════════════════════════════════════════════════════════════════════
-- COBROS POR FACTURA DESDE CUALQUIER BANCO  (Betangar — hrkjddehqnzcqwlkklqm)
-- ═══════════════════════════════════════════════════════════════════════════
-- Problema real: la Alcaldía no siempre paga desde el BNC. La FIEL CUMPLIMIENTO
-- 10% de la factura 000632 entró el 24/06/2026 por Bs 1.308.798,35 (ref 22741784)
-- desde BANCA AMIGA. La conciliación solo mira el BNC (API + notificaciones) →
-- ese cobro no cruza NUNCA y la pata queda eternamente "⏳ por depositar" aunque
-- el dinero ya entró.
--
-- Esta tabla es la FUENTE ÚNICA de "esta pata de esta factura YA se cobró",
-- independiente del banco por donde entró. La conciliación la inyecta como un
-- movimiento de banco más, así que cruza con el motor normal (mismo camino, sin
-- lógica paralela).
--
-- Identidad = factura + pata → idempotente, no se puede duplicar el mismo cobro.
create table if not exists public.cobros_factura(
  id          text primary key,                                  -- '000632-fiel'
  fact        text not null,
  pata        text not null check (pata in ('neto','fiel')),
  fecha       date not null,
  banco       text not null,                                     -- 'Banca Amiga', 'BNC', ...
  referencia  text,
  monto_bs    numeric not null check (monto_bs > 0),
  obs         text,
  creado_por  text,
  created_at  timestamptz not null default now(),
  unique (fact, pata)
);

create index if not exists idx_cobros_factura_fact on public.cobros_factura(fact);

-- RLS: mismo patrón por ROL que abonos / pagos_alcaldia (fail-closed: sin política
-- que aplique, no se ve nada). anon NO toca esta tabla.
alter table public.cobros_factura enable row level security;

drop policy if exists btg_rol_lectura on public.cobros_factura;
create policy btg_rol_lectura on public.cobros_factura for select to authenticated
  using (app_rol() = any (array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh']));

drop policy if exists btg_rol_ins on public.cobros_factura;
create policy btg_rol_ins on public.cobros_factura for insert to authenticated
  with check (app_rol() = any (array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));

drop policy if exists btg_rol_upd on public.cobros_factura;
create policy btg_rol_upd on public.cobros_factura for update to authenticated
  using (app_rol() = any (array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
  with check (app_rol() = any (array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));

drop policy if exists btg_del_superadmin on public.cobros_factura;
create policy btg_del_superadmin on public.cobros_factura for delete to authenticated
  using (app_rol() = any (array['superadmin','admin','directivo']));

revoke all on public.cobros_factura from anon;
grant select, insert, update, delete on public.cobros_factura to authenticated;
