-- FlotaMax - Plan preventivo SUGERIDO por combinacion (tipo+combustible),
-- doble intervalo (inspeccion/sustitucion) y medida por unidad (km/horas/tiempo).
-- Aditivo e idempotente. Solo authenticated. (Sin default de texto para evitar problemas de copiado.)

alter table mant_items add column if not exists tipo text;
alter table mant_items add column if not exists combustible text;
alter table mant_items add column if not exists inspeccion numeric default 0;
alter table mant_items add column if not exists sustitucion numeric default 0;
alter table mant_items add column if not exists critico_seguridad boolean default false;
alter table mant_items add column if not exists fuente text;
alter table unidad_config add column if not exists medida text;
alter table unidad_config add column if not exists horas_actuales numeric default 0;
alter table mantenimientos add column if not exists tipo_trabajo text;
alter table mantenimientos add column if not exists horas numeric default 0;
revoke all on mant_items from anon;
revoke all on unidad_config from anon;
revoke all on mantenimientos from anon;
