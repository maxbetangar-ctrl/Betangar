-- ════════════════════════════════════════════════════════════════════════════
-- PLANILLA ESPECIAL / NÓMINA EXTRAS — pagos por actividades fuera de viajes
-- (traslado de unidad de patio a autolavado, lavados, apoyos puntuales, etc.).
-- calcNom suma estos pagos al total de la semana y la auditoría los reconoce → la nómina cuadra.
-- Dos modos: 'viajes' (N viajes-equivalente × la tarifa del trabajador) o 'monto' (monto fijo $).
-- RLS solo authenticated (no anon), como el resto de las tablas sensibles. Correr en Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.nomina_extras (
  id          text primary key,
  fecha       date,
  emp_id      text,
  emp_nombre  text,
  actividad   text,
  modo        text default 'viajes',   -- 'viajes' | 'monto'
  viajes      numeric default 0,        -- viajes-equivalente (modo 'viajes')
  monto       numeric default 0,        -- monto fijo $ (modo 'monto')
  created_at  timestamptz default now()
);
alter table public.nomina_extras enable row level security;
-- Política: solo usuarios autenticados (la app los lee/escribe con la sesión del usuario).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nomina_extras' and policyname='nomina_extras_auth') then
    create policy nomina_extras_auth on public.nomina_extras for all to authenticated using (true) with check (true);
  end if;
end $$;
revoke all on table public.nomina_extras from anon;
