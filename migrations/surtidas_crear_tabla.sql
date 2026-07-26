-- ════════════════════════════════════════════════════════════════════════════
-- CREAR LA TABLA `surtidas` (combustible surtido por unidad)
--
-- POR QUÉ EXISTE ESTE ARCHIVO: `surtidas` se creó en su día por MCP, directo
-- contra la base, y NUNCA quedó un archivo en el repo. Resultado: hay 4
-- migraciones que le AGREGAN columnas (`flotilla_surtidas_gasolina_estaciones`,
-- `surtidas_correccion`, `surtidas_tope_litros`, `surtidas_listar_rpc_supervisor`)
-- pero NINGUNA que la cree. Una base nueva corre las 4 y todas fallan, porque la
-- tabla no está. Esta migración cierra ese hueco.
--
-- La estructura se sacó de la base VIVA de Flotilla (mcvizzknpqrggohbohcw) el
-- 2026-07-26, o sea que ya trae aplicadas las columnas que agregaron las otras
-- migraciones (tipo_combustible, corregido_por/at, valor_anterior,
-- litros_transporte). Correr ESTA primero y las otras después es idempotente:
-- todas usan `add column if not exists`.
--
-- Es aditiva: `if not exists` en todo. En una base que ya tiene la tabla no
-- hace nada.
--
-- ⚠️ ORDEN: correr ANTES `borrar_solo_superadmin_rol_auditor_2026-07-25.sql`,
-- que es el que crea `app_puede_borrar()`. Si no existe, la policy de DELETE de
-- acá abajo falla.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.surtidas (
  id                text primary key,
  fecha             date,
  hora              text,
  cam               text,
  chofer            text,
  tanque            text,
  litros            numeric default 0,
  costo_litro_usd   numeric default 0.75,
  costo_usd         numeric default 0,
  tasa_bcv          numeric,
  costo_bs          numeric,
  foto_url          text,
  lat               double precision,
  lng               double precision,
  precision_gps     double precision,
  nota              text,
  token             text,
  created_at        timestamptz default now(),
  -- de `flotilla_surtidas_gasolina_estaciones_2026-07-24.sql`
  tipo_combustible  text,
  -- de `surtidas_correccion_2026-07-25.sql`: quién corrigió lo que el chofer
  -- cargó mal, cuándo, y qué decía antes (rastro, no borrado)
  corregido_por     text,
  corregido_at      timestamptz,
  valor_anterior    jsonb,
  -- combustible que el camión LLEVA (no el que consume): se declara al cargar
  -- y se cuadra al dejarlo
  litros_transporte numeric default 0
);

create index if not exists idx_surtidas_fecha on public.surtidas using btree (fecha);
create index if not exists idx_surtidas_cam   on public.surtidas using btree (cam);

alter table public.surtidas enable row level security;

-- Políticas idénticas a las de Flotilla. OJO: no hay policy de INSERT a
-- propósito — la surtida la registra el chofer por RPC (security definer), no
-- escribiendo la tabla directo.
drop policy if exists btg_rol_lectura on public.surtidas;
create policy btg_rol_lectura on public.surtidas for select
  using (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh']));

drop policy if exists btg_rol_upd on public.surtidas;
create policy btg_rol_upd on public.surtidas for update
  using      (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
  with check (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));

-- Borrar exige el permiso con token (rol auditor / superadmin), igual que el resto.
drop policy if exists btg_rol_del on public.surtidas;
create policy btg_rol_del on public.surtidas for delete using (app_puede_borrar());

-- Tabla nueva = anon no toca nada (norma: revocar anon al crear).
revoke all on public.surtidas from anon;
grant select, insert, update, delete on public.surtidas to authenticated;
