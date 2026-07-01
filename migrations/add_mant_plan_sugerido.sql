-- FlotaMax - Plan preventivo SUGERIDO por combinacion (tipo+combustible),
-- doble intervalo (inspeccion/sustitucion) y medida por unidad (km/horas/tiempo).
-- Aditivo e idempotente. Solo authenticated.

-- mant_items: pasa a ser el store de las PLANTILLAS por combinacion.
alter table mant_items add column if not exists tipo              text default '';
alter table mant_items add column if not exists combustible       text default '';
alter table mant_items add column if not exists inspeccion        numeric default 0;
alter table mant_items add column if not exists sustitucion       numeric default 0;
alter table mant_items add column if not exists critico_seguridad boolean default false;
alter table mant_items add column if not exists fuente            text default '';

-- unidad_config: como se mide la unidad + contador de horas para equipos.
alter table unidad_config add column if not exists medida         text default '';
alter table unidad_config add column if not exists horas_actuales numeric default 0;

-- mantenimientos: tipo de trabajo (inspeccion/cambio/correctivo) + lectura de horas del equipo.
alter table mantenimientos add column if not exists tipo_trabajo  text default '';
alter table mantenimientos add column if not exists horas         numeric default 0;

-- Seguridad (reafirmar): solo usuarios autenticados.
revoke all on mant_items     from anon;
revoke all on unidad_config  from anon;
revoke all on mantenimientos from anon;
