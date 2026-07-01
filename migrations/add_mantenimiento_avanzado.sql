-- FlotaMax - Mantenimiento avanzado (Fase 1: Hoja de vida por unidad + preventivo)
-- Aditivo e idempotente. Correr en Supabase SQL Editor.

-- 1) Catalogo de items mantenibles (bateria, aceite, filtros, rodamientos...).
create table if not exists mant_items (
  id             text primary key,
  nombre         text not null,
  categoria      text default '',
  base           text not null default 'km',
  intervalo      numeric not null default 0,
  aviso_anticipo numeric default 0,
  tipo_unidad    text default '',
  activo         boolean default true,
  orden          integer default 0
);
alter table mant_items enable row level security;
drop policy if exists mant_items_all on mant_items;
create policy mant_items_all on mant_items for all using (true) with check (true);

-- 2) Historial por item (extiende la tabla mantenimientos existente).
alter table mantenimientos add column if not exists id         text;
alter table mantenimientos add column if not exists item_id    text default '';
alter table mantenimientos add column if not exists costo_usd  numeric default 0;
alter table mantenimientos add column if not exists proveedor  text default '';
alter table mantenimientos add column if not exists foto_url   text default '';
create unique index if not exists mant_id_uidx on mantenimientos(id);
create index if not exists mant_cam_idx on mantenimientos(cam);
create index if not exists mant_item_idx on mantenimientos(item_id);

-- 3) Config por unidad: tipo / combustible / uso (para heredar items por tipo).
create table if not exists unidad_config (
  cam         text primary key,
  tipo        text default '',
  combustible text default '',
  uso         text default ''
);
alter table unidad_config enable row level security;
drop policy if exists unidad_config_all on unidad_config;
create policy unidad_config_all on unidad_config for all using (true) with check (true);
