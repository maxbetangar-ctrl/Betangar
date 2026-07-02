-- FlotaMax - Trazabilidad de entregas (piloto PWA): prueba de entrega con foto en vivo + GPS.
-- Aditivo e idempotente. Tabla operativa escrita por el chofer con la anon key (igual que
-- viajes_chofer / checklist). Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).

create table if not exists entregas (
  id text primary key,
  cam text,
  chofer text,
  cliente text,
  direccion text,
  lat double precision,
  lng double precision,
  precision_gps double precision,
  foto_url text,
  fecha date,
  hora text,
  estado text,
  recibido_por text,
  recibido_ci text,
  recibido_at timestamptz,
  nota text,
  token text,
  created_at timestamptz default now()
);

alter table entregas enable row level security;

drop policy if exists entregas_anon_all on entregas;
create policy entregas_anon_all on entregas for all to anon using (true) with check (true);

drop policy if exists entregas_auth_all on entregas;
create policy entregas_auth_all on entregas for all to authenticated using (true) with check (true);

-- Bucket publico para las fotos de entrega (el chofer sube con anon).
insert into storage.buckets (id, name, public) values ('entregas', 'entregas', true) on conflict (id) do nothing;

drop policy if exists entregas_foto_insert on storage.objects;
create policy entregas_foto_insert on storage.objects for insert to anon with check (bucket_id = 'entregas');

drop policy if exists entregas_foto_read on storage.objects;
create policy entregas_foto_read on storage.objects for select to anon using (bucket_id = 'entregas');
