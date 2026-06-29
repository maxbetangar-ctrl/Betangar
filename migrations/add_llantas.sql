-- ════════════════════════════════════════════════════════════════════════════
-- LLANTAS PERSISTENTES + GESTIÓN POR DIBUJO (mm). Antes el módulo Llantas vivía SOLO en memoria
-- (se perdía al recargar). Ahora persiste por posición de cada camión (id = 'CAM|POSICION') e
-- incluye profundidad del dibujo (mm), marca y precio → permite calcular costo por mm de vida útil
-- y costo por km, y saber qué MARCA rinde más en Maracaibo. RLS authenticated (no anon).
-- Correr en Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.llantas (
  id              text primary key,        -- 'JAC-B001|Delantera Izquierda'
  cam             text,
  posicion        text,
  estado          text default 'Buena',
  km              numeric default 0,        -- km del camión en la última actualización
  fecha           date,
  marca           text,
  precio          numeric default 0,        -- costo de la llanta (para costo/mm y costo/km)
  mm              numeric,                  -- profundidad del dibujo ACTUAL
  mm_inicial      numeric,                  -- profundidad al instalar (llanta nueva)
  km_instalada    numeric default 0,        -- km del camión al instalar
  fecha_instalada date,
  created_at      timestamptz default now()
);
alter table public.llantas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='llantas' and policyname='llantas_auth') then
    create policy llantas_auth on public.llantas for all to authenticated using (true) with check (true);
  end if;
end $$;
revoke all on table public.llantas from anon;
