-- BETANGAR — `configuracion` guarda SECRETOS: cerrar la fila 'wassenger'
-- Fecha: 2026-07-23
--
-- HUECO (verificado en vivo hoy): las 4 políticas de `configuracion` eran
-- `authenticated` a secas, sin filtro. La fila clave='wassenger' guarda
-- {token, device} EN CLARO → cualquier usuario de oficina (vigilante,
-- visualizador, asistencia y hasta las cuentas demo_*) podía leer el token
-- de WhatsApp. Ese token es el MISMO de las 4 apps del negocio
-- (ver memoria wassenger-token-4-apps-negocio) → la fuga no era solo de Betangar.
--
-- CONSUMIDORES VERIFICADOS antes de cerrar (norma: verificar el consumidor):
--   · app.js NO lee la fila 'wassenger': ya usa la RPC `wassenger_estado`
--     (SECURITY DEFINER, devuelve activo/tiene_token SIN el token) — app.js:2346.
--   · app.js NO escribe ni borra 'wassenger' (0 upserts, 0 deletes con esa clave).
--   · Todas las demás lecturas son `.eq('clave', ...)` puntuales: ninguna hace
--     select * → cerrar solo esa fila no deja a nadie sin datos.
--   · fichar.html / chofer.html no tocan `configuracion` (0 referencias).
--   · El worker `procesar_cola_wassenger` y las edge functions usan service_role,
--     que no pasa por RLS → siguen leyendo el token.
--
-- ROLES REALES en btg_usuarios: superadmin, operador, rrhh, visualizador,
-- asistencia, vigilante, mecanico, operativo, directivo, demo_admin,
-- demo_operador, demo_rrhh. NO existe el rol 'admin' → el candado es 'superadmin'.
-- Ojo: demo_admin queda FUERA a propósito (es la cuenta que ve un prospecto).
--
-- ESCRITURA: se deja abierta a authenticated para el RESTO de claves. No se
-- restringe por rol porque muchos roles guardan config legítima (asistencia →
-- 'asistencia_data', rrhh → patio/alias, operador → tasas, mecanico → tanque).
-- Cerrar por lista de roles rompería el guardado EN SILENCIO. Lo que se blinda
-- es la lista de CLAVES SENSIBLES (`cfg_clave_sensible`), mismo molde que ya
-- tenía Flotilla — no solo el token, también A QUIÉN LE LLEGAN LOS AVISOS
-- ('whatsapp', 'wa_empresarial', 'recordatorios_cfg'): si eso queda abierto,
-- cualquier rol se pone a sí mismo de destinatario de las alertas de la empresa.
--
-- Verificado en app.js: el panel de Configuración (que escribe 'general',
-- 'whatsapp', 'wa_empresarial', 'recordatorios_cfg') solo lo alcanzan los roles
-- superadmin / admin / demo_admin (PERMISOS, app.js:330). 'viajes_semanal_tel',
-- 'tasa_bnc' y 'gemini_api_key' no las escribe el navegador (0 referencias):
-- las ponen las edge functions con service_role → incluirlas no rompe nada.
--
-- ⚠️ demo_admin queda FUERA a propósito. Hoy la demo corre en la MISMA base que
-- Betangar real, así que un prospecto con la cuenta demo podía cambiar a quién
-- le llegan los WhatsApp REALES de la empresa. Tras esta migración el panel de
-- config le dará error al demo en esas claves (error visible, no silencioso).

begin;

-- Lista de claves sensibles (mismo molde que Flotilla, adaptado a las claves
-- que existen en Betangar). IMMUTABLE: se puede usar dentro de una policy.
create or replace function public.cfg_clave_sensible(p_clave text)
returns boolean language sql immutable
set search_path = public, pg_temp
as $$
  select p_clave in (
    'wassenger',            -- token de WhatsApp (el MISMO de las 4 apps)
    'gemini_api_key',       -- credencial de IA
    'general',              -- config de la empresa (marca, retenciones, precios)
    'whatsapp','wa_empresarial','recordatorios_cfg','viajes_semanal_tel',
    'tasa_bnc'
  );
$$;

drop policy if exists cfg_sel on public.configuracion;
drop policy if exists cfg_ins on public.configuracion;
drop policy if exists cfg_upd on public.configuracion;
drop policy if exists cfg_del on public.configuracion;

-- LEER: todo, menos el secreto
create policy cfg_sel on public.configuracion
  for select to authenticated
  using ( clave <> 'wassenger' );

-- CREAR: las claves sensibles solo superadmin/admin
create policy cfg_ins on public.configuracion
  for insert to authenticated
  with check ( not cfg_clave_sensible(clave) or app_rol() in ('superadmin','admin') );

-- MODIFICAR: idem (using + with_check, para que no se pueda renombrar la clave
-- de una fila cualquiera a una sensible ni al revés)
create policy cfg_upd on public.configuracion
  for update to authenticated
  using      ( not cfg_clave_sensible(clave) or app_rol() in ('superadmin','admin') )
  with check ( not cfg_clave_sensible(clave) or app_rol() in ('superadmin','admin') );

-- BORRAR: solo superadmin (verificado: la app nunca borra filas de configuracion)
create policy cfg_del on public.configuracion
  for delete to authenticated
  using ( app_rol() = 'superadmin' );

commit;
