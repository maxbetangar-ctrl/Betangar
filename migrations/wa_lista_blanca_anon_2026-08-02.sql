-- ============================================================================
-- Auditoría multi-tenant 2026-08-02 — P0
-- Apps: Betangar (base hrkjddehqnzcqwlkklqm) y FLOTILLA (mcvizzknpqrggohbohcw)
-- Tabla: public.cola_mensajes
-- ============================================================================
--
-- QUÉ PASABA
--   cola_mensajes(telefono, mensaje)
--        ↓  cron 'betangar-wassenger-worker'  cada 3 minutos
--        ↓  Wassenger  →  +584149614915 (el WhatsApp del negocio, 4 apps)
--
--   La política `cm_anon_ins` era:  FOR INSERT TO anon WITH CHECK (true)
--   y la anon key va publicada en el bundle de Betangar, Flotilla, VIDECA y
--   FlotaMax-DEMO. Cualquiera que la copie del JS podía encolar CUALQUIER texto
--   a CUALQUIER número y el worker lo enviaba desde el número del negocio en
--   menos de 3 minutos. Phishing a los clientes con identidad del negocio, y
--   camino directo a que Meta tumbe el número del que dependen 4 apps.
--   Ya van 1.981 mensajes enviados por esa cola.
--
-- POR QUÉ NO SE REVOCA anon Y YA
--   `chofer_login: false` en Betangar («choferes del aseo sin clave») y
--   `configuracion.chofer_pedir_clave = false` en FLOTILLA: el chofer trabaja
--   SIN sesión, así que encola como anon (chofer.html). Revocar lo dejaría mudo.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   anon deja de poder escribirle a NÚMEROS ARBITRARIOS: solo a destinos que ya
--   son del negocio. El atacante pierde el vector (no puede alcanzar a terceros);
--   el chofer sigue avisando a supervisor/jefe igual que hoy.
--   `authenticated` (el panel con sesión) NO se toca: sigue pudiendo mandar a
--   números nuevos — bienvenidas, comunicados, clientes nuevos.
--
--   Lista blanca = tabla explícita y auditable, sembrada con:
--     · los destinos que YA recibieron mensajes (histórico real)
--     · empleados.tel y empleados.whatsapp  (dinámico: un empleado nuevo entra solo)
--     · los teléfonos de `configuracion`
--
--   Normalización a los ÚLTIMOS 10 DÍGITOS: así 04147379886, 584147379886 y
--   +58 414-7379886 son el mismo número, y no reaparece el bug del código de
--   país duplicado.
--
-- REVERSIBLE:
--   drop policy if exists cm_anon_ins on public.cola_mensajes;
--   create policy cm_anon_ins on public.cola_mensajes for insert to anon with check (true);
--
-- Idempotente. Correr en hrkjddehqnzcqwlkklqm y en mcvizzknpqrggohbohcw.
-- ============================================================================

-- ── 1) Canonizar un teléfono: solo dígitos, últimos 10 ──────────────────────
create or replace function public.wa_tel_canon(p_tel text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $$
  select right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 10);
$$;

-- ── 2) La lista blanca ──────────────────────────────────────────────────────
create table if not exists public.wa_destinos_permitidos (
  telefono_canon text primary key,
  nota           text,
  creado_at      timestamptz not null default now()
);

alter table public.wa_destinos_permitidos enable row level security;
revoke all on public.wa_destinos_permitidos from anon;

drop policy if exists wa_dest_sel on public.wa_destinos_permitidos;
drop policy if exists wa_dest_ins on public.wa_destinos_permitidos;
drop policy if exists wa_dest_upd on public.wa_destinos_permitidos;
drop policy if exists wa_dest_del on public.wa_destinos_permitidos;

create policy wa_dest_sel on public.wa_destinos_permitidos
  for select to authenticated using (true);
create policy wa_dest_ins on public.wa_destinos_permitidos
  for insert to authenticated with check (public.app_rol() = any (array['superadmin','admin']));
create policy wa_dest_upd on public.wa_destinos_permitidos
  for update to authenticated
  using      (public.app_rol() = any (array['superadmin','admin']))
  with check (public.app_rol() = any (array['superadmin','admin']));
create policy wa_dest_del on public.wa_destinos_permitidos
  for delete to authenticated using (public.app_puede_borrar());

comment on table public.wa_destinos_permitidos is
  'Lista blanca de destinos a los que el chofer SIN LOGIN (anon) puede encolar WhatsApp. '
  'El panel autenticado no está limitado por esta tabla. Ver wa_lista_blanca_anon_2026-08-02.sql';

-- ── 3) Sembrarla con lo que YA es del negocio ───────────────────────────────
-- a) destinos históricos reales (lo que la app viene mandando)
insert into public.wa_destinos_permitidos (telefono_canon, nota)
select distinct public.wa_tel_canon(cm.telefono), 'histórico cola_mensajes'
from public.cola_mensajes cm
where public.wa_tel_canon(cm.telefono) <> ''
on conflict (telefono_canon) do nothing;

-- b) teléfonos de la configuración del negocio
insert into public.wa_destinos_permitidos (telefono_canon, nota)
select distinct public.wa_tel_canon(c.valor), 'configuracion.' || c.clave
from public.configuracion c
where c.clave ~* '(tel|whats|wa_)'
  and length(public.wa_tel_canon(c.valor)) = 10
on conflict (telefono_canon) do nothing;

-- ── 4) ¿Puede anon escribirle a este número? ────────────────────────────────
-- SECURITY DEFINER para que anon pueda consultar empleados/lista sin abrirlas.
create or replace function public.wa_destino_permitido(p_tel text)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select case when public.wa_tel_canon(p_tel) = '' then false else exists (
      select 1 from public.wa_destinos_permitidos w
      where w.telefono_canon = public.wa_tel_canon(p_tel)
    ) or exists (
      -- empleados: dinámico, para que uno nuevo no quede mudo esperando el alta
      select 1 from public.empleados e
      where public.wa_tel_canon(e.tel)      = public.wa_tel_canon(p_tel)
         or public.wa_tel_canon(e.whatsapp) = public.wa_tel_canon(p_tel)
    ) end;
$$;

revoke all on function public.wa_destino_permitido(text) from public, anon;
grant execute on function public.wa_destino_permitido(text) to anon, authenticated, service_role;

-- ── 5) La política: anon solo a destinos del negocio ────────────────────────
drop policy if exists cm_anon_ins on public.cola_mensajes;
create policy cm_anon_ins on public.cola_mensajes
  for insert to anon
  with check (public.wa_destino_permitido(telefono));

-- `authenticated` (cola_mensajes_ins2 / cm_auth_ins) NO se toca a propósito:
-- el panel con sesión sigue pudiendo escribir a números nuevos.
