-- ════════════════════════════════════════════════════════════════════════════
-- MOVIMIENTOS DE INVENTARIO PERSISTENTES + AUDITORÍA DE INSUMOS (#2). Antes INV_MOV vivía SOLO en
-- memoria (se perdía al recargar) → no se podía auditar nada. Ahora cada uso de repuesto persiste con
-- nº de FACTURA y FOTO de la pieza vieja, y el sistema avisa si la misma pieza se cambió hace poco
-- (¿garantía?). RLS authenticated (no anon). Correr en Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.inv_movimientos (
  id           text primary key,
  fecha        date,
  item         text,
  item_id      text,
  tipo         text,                 -- 'Uso' | 'Entrada'
  cantidad     numeric,
  cam          text,
  motivo       text,
  stock_result numeric,
  factura      text,                 -- nº de factura del repuesto (obligatorio en Uso)
  foto_url     text,                 -- foto de la pieza vieja (Storage)
  precio       numeric default 0,
  created_at   timestamptz default now()
);
alter table public.inv_movimientos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inv_movimientos' and policyname='inv_mov_auth') then
    create policy inv_mov_auth on public.inv_movimientos for all to authenticated using (true) with check (true);
  end if;
end $$;
revoke all on table public.inv_movimientos from anon;

-- Bucket de Storage para las fotos de piezas/insumos (lectura pública, escritura autenticada).
insert into storage.buckets (id,name,public) values ('insumos','insumos',true) on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='insumos_read') then
    create policy insumos_read on storage.objects for select using (bucket_id='insumos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='insumos_write') then
    create policy insumos_write on storage.objects for insert to authenticated with check (bucket_id='insumos');
  end if;
end $$;
