-- FlotaMax - Registro maestro de Unidades y Equipos (fuente unica de datos de cada unidad).
-- Extiende unidad_config con la ficha completa. Aditivo e idempotente.
-- SEGURIDAD: acceso SOLO a usuarios autenticados (coherente con el resto de la app); anon revocado.

-- 1) Ficha completa de la unidad.
alter table unidad_config add column if not exists nombre            text default '';
alter table unidad_config add column if not exists marca             text default '';
alter table unidad_config add column if not exists modelo            text default '';
alter table unidad_config add column if not exists anio              text default '';
alter table unidad_config add column if not exists placa             text default '';
alter table unidad_config add column if not exists vin               text default '';
alter table unidad_config add column if not exists serial_motor      text default '';
alter table unidad_config add column if not exists serial_carroceria text default '';
alter table unidad_config add column if not exists titular           text default '';
alter table unidad_config add column if not exists foto              text default '';
alter table unidad_config add column if not exists titulo_pdf        text default '';
alter table unidad_config add column if not exists chofer            text default '';
alter table unidad_config add column if not exists activo            boolean default true;
alter table unidad_config add column if not exists notas             text default '';

-- 2) SEGURIDAD: cerrar a anon, abrir SOLO a authenticated (las tablas nuevas del modulo
--    de mantenimiento se habian creado con policy publica; aca se corrige).
alter table unidad_config enable row level security;
drop policy if exists unidad_config_all  on unidad_config;
drop policy if exists unidad_config_auth on unidad_config;
create policy unidad_config_auth on unidad_config for all to authenticated using (true) with check (true);
revoke all on unidad_config from anon;

alter table mant_items enable row level security;
drop policy if exists mant_items_all  on mant_items;
drop policy if exists mant_items_auth on mant_items;
create policy mant_items_auth on mant_items for all to authenticated using (true) with check (true);
revoke all on mant_items from anon;

-- mantenimientos ya existia (acceso autenticado); reforzamos el bloqueo a anon por las dudas.
revoke all on mantenimientos from anon;
