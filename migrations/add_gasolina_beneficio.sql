-- ════════════════════════════════════════════════════════════════════════════
-- GASOLINA a EMPLEADOS (beneficio) — DISTINTO del gasoil de la flota.
-- Es GASOLINA para los carros PERSONALES de empleados clave, que usan para cosas de la
-- operatividad de la empresa. Es un BENEFICIO (costo real, afecta Utilidad Real) pero NO es
-- prestacional (no entra a prestaciones/liquidación ni a la base de nómina). Va atado a la PERSONA.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.gasolina_beneficio (
  id           text primary key,
  fecha        date,
  empleado_id  text,
  empleado     text,          -- nombre (para mostrar sin join)
  litros       numeric,
  monto_usd    numeric,       -- costo
  uso          text,          -- para qué la usó (operatividad)
  nota         text,
  creado_en    timestamptz default now()
);
alter table public.gasolina_beneficio enable row level security;
revoke all on public.gasolina_beneficio from anon;
grant all on public.gasolina_beneficio to authenticated;
drop policy if exists gasben_rw on public.gasolina_beneficio;
create policy gasben_rw on public.gasolina_beneficio for all to authenticated
  using      (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
  with check (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));
drop policy if exists gasben_ro on public.gasolina_beneficio;
create policy gasben_ro on public.gasolina_beneficio for select to authenticated using (app_rol() = 'visualizador');
