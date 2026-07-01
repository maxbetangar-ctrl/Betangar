-- ═══════════════════════════════════════════════════════════════════════
-- FlotaMax · Mantenimiento avanzado (Fase 1: Hoja de vida por unidad + preventivo)
-- Additivo: crea catálogo de ítems, extiende la tabla mantenimientos por ÍTEM,
-- y agrega config de tipo por unidad (para heredar ítems por tipo).
-- Correr en Supabase SQL Editor. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

-- 1) CATÁLOGO de ítems mantenibles (batería, aceite, filtros, rodamientos…),
--    con su intervalo (por km o por tiempo) y a qué TIPO de unidad aplica.
create table if not exists mant_items (
  id             text primary key,
  nombre         text not null,
  categoria      text default '',
  base           text not null default 'km',   -- 'km' | 'dias' | 'meses'
  intervalo      numeric not null default 0,    -- 5000 (km) · 365 (dias) · 12 (meses)
  aviso_anticipo numeric default 0,             -- avisar N km / N dias antes de vencer
  tipo_unidad    text default '',               -- '' = aplica a TODAS; o el tipo (diesel/gasolina/…)
  activo         boolean default true,
  orden          int default 0
);
alter table mant_items enable row level security;
do $$ begin
  create policy mant_items_all on mant_items for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- 2) HISTORIAL por ÍTEM (hoja de vida). Extiende la tabla mantenimientos existente
--    (cam, f, km, tipo, desc_trabajo) sin perder los registros viejos.
alter table mantenimientos add column if not exists id         text;
alter table mantenimientos add column if not exists item_id    text default '';
alter table mantenimientos add column if not exists costo_usd  numeric default 0;
alter table mantenimientos add column if not exists proveedor  text default '';
alter table mantenimientos add column if not exists foto_url   text default '';
-- índice ÚNICO en id → habilita upsert(onConflict:'id') de la app (nulos viejos son distintos, OK).
create unique index if not exists mant_id_uidx on mantenimientos(id);
-- índices para buscar rápido el historial de una unidad / por ítem
create index if not exists mant_cam_idx on mantenimientos(cam);
create index if not exists mant_item_idx on mantenimientos(item_id);

-- 3) CONFIG por unidad: tipo / combustible / uso → para heredar los ítems por tipo.
create table if not exists unidad_config (
  cam         text primary key,
  tipo        text default '',
  combustible text default '',   -- diesel | gasolina
  uso         text default ''    -- viajes | personal
);
alter table unidad_config enable row level security;
do $$ begin
  create policy unidad_config_all on unidad_config for all using (true) with check (true);
exception when duplicate_object then null; end $$;
