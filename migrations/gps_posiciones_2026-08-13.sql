-- BETANGAR — GPS del proveedor externo: posiciones, resumen por día y estado del enganche
-- Fecha: 2026-08-13
--
-- QUÉ ES: el proveedor de rastreo (plan de rastreo y recuperación de robo) expone un API
-- .NET/JSON con autenticación básica + credencial en la petición. Reporta CADA MINUTO por
-- unidad y las fechas vienen en HORA DE VENEZUELA (confirmado por su área técnica el
-- 13/08/2026). Límite: 10 peticiones por minuto; al pasarse NO bloquea, hace esperar.
--
-- QUÉ NO DA (no prometerlo): odómetro de tablero, consumo, frenadas/aceleraciones. El
-- scoring del conductor (app.js calcScoringChoferes) SIGUE siendo estimado.
--
-- PARA QUÉ SIRVE lo que sí da (posición + hora):
--   1. Contar vueltas patio → botadero → patio contra `planillas` = respaldo de CADA viaje
--      facturado a la Alcaldía. Hoy no hay nada fuera del papel que lo pruebe.
--   2. Km recorrido calculado contra el km que teclea el chofer (checklist / `km_data`).
--   3. Hora real de salida y regreso, para cruzar con `porteria` y `asistencia_dia`.
-- Las geocercas NO se crean acá: ya existen en `sitios_asistencia` (migración
-- sitios_asistencia_geocerca_2026-07-24.sql), y las mueve SOLO administración.
--
-- ⚠️ VOLUMEN — leer antes de correr esto:
--   1 unidad × 1 reporte/min = 1.440 filas/día. Las 12 unidades = 17.280/día ≈ 6,3 MILLONES
--   al año. Por eso el diseño separa DOS cosas:
--     · `gps_posiciones` = detalle crudo. Es PODABLE: se conserva una ventana (60 días) y lo
--       viejo se borra. Es lo que pesa.
--     · `gps_dia` = resumen por unidad y fecha. Es PERMANENTE y pesa nada (12 filas/día ≈
--       4.400 al año). Es lo que sostiene la auditoría a futuro: si el detalle ya se podó,
--       el resumen sigue diciendo cuántas vueltas y cuántos km hizo esa unidad ese día.
--   ⛔ La poda NO se programa en esta migración. La decide Máximo (cuántos días se guardan).
--
-- ⚠️ EL SECRETO NO VIVE ACÁ. Usuario y clave del API van en los secretos del servidor
--   (Edge Function), NUNCA en app.js ni en chofer.html: cualquiera que abra el inspector ve
--   lo que esté en el bundle — es el mismo hueco de la clave `anon`. Estas tablas las
--   escribe SOLO el conector con service_role; la app únicamente LEE.

begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. EQUIPOS: casar el identificador del proveedor con la unidad de Betangar
-- ══════════════════════════════════════════════════════════════════════════════
-- Sin esta tabla no se sabe que "el equipo 8871234" es "JAC-B007". El proveedor puede
-- nombrarlas por placa, por IMEI o por un id propio; acá se traduce una sola vez.
create table if not exists public.gps_equipos (
  id_equipo   text primary key,                   -- como lo llama el proveedor (IMEI/id/placa)
  cam         text not null,                      -- unidad Betangar: 'JAC-B0XX'
  placa       text,
  activo      boolean not null default true,      -- false = equipo retirado, no se consulta
  notas       text,
  creado      timestamptz not null default now()
);
create unique index if not exists gps_equipos_cam_uq
  on public.gps_equipos(cam) where activo;        -- una unidad, un equipo activo

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. POSICIONES: el detalle crudo que baja el conector
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.gps_posiciones (
  id          bigserial primary key,
  cam         text        not null,               -- ya traducido a 'JAC-B0XX'
  ts          timestamptz not null,               -- momento del reporte (el conector convierte desde hora Venezuela)
  lat         double precision not null,
  lon         double precision not null,
  velocidad   numeric,                            -- km/h, si viene
  rumbo       numeric,                            -- grados, si viene
  ignicion    boolean,                            -- motor encendido — NULL si el proveedor no lo manda
  odometro    numeric,                            -- solo si viene; NO es el del tablero
  id_equipo   text,
  creado      timestamptz not null default now()
);

-- Idempotencia: el conector reintenta y vuelve a pedir rangos ya bajados. Sin esta llave
-- única, cada reintento duplicaría el día entero y el km calculado saldría al doble.
-- Un solo índice a propósito: sirve de llave única Y de índice de consulta. Postgres recorre
-- un btree hacia atrás sin ayuda, así que un segundo índice (cam, ts desc) sería peso muerto
-- — y sobre 1,5 millones de filas ese peso muerto son ~45 MB de base pagados para nada.
create unique index if not exists gps_posiciones_cam_ts_uq
  on public.gps_posiciones(cam, ts);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RESUMEN POR DÍA: permanente, sobrevive a la poda del detalle
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.gps_dia (
  cam             text not null,
  f               date not null,                  -- fecha del NEGOCIO (hora Venezuela)
  km_gps          numeric,                        -- recorrido calculado entre puntos
  vueltas         integer,                        -- entradas al botadero detectadas por geocerca
  primera_salida  timestamptz,
  ultimo_regreso  timestamptz,
  min_ralenti     integer,                        -- minutos encendido y parado (NULL si no hay ignición)
  puntos          integer,                        -- cuántas posiciones sostienen estos números
  hueco_max_min   integer,                        -- ⚠️ mayor rato SIN reportar, en minutos
  calculado       timestamptz not null default now(),
  primary key (cam, f)
);
-- `puntos` y `hueco_max_min` no son adorno: son la MEDIDA DE CONFIANZA del día. Un día con
-- 1.440 puntos y hueco de 2 min se puede cotejar contra la planilla; uno con 300 puntos y un
-- hueco de 4 horas NO — ahí faltan vueltas reales y reclamarle a ese chofer sería injusto.
-- Un error se ve; un hueco no. Por eso el hueco se guarda y se muestra.

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. ESTADO DEL ENGANCHE: para que el silencio no pase por normalidad
-- ══════════════════════════════════════════════════════════════════════════════
-- Si el conector deja de traer datos (clave cambiada, equipo desconectado, API caída), sin
-- esta tabla se ve EXACTAMENTE IGUAL que si todo estuviera bien: simplemente no entran filas.
create table if not exists public.gps_sync_estado (
  cam             text primary key,
  bajado_hasta    timestamptz,                    -- hasta qué momento está descargado
  ultima_corrida  timestamptz,
  ultimo_ok       timestamptz,
  ultimo_error    text,
  intentos_fallidos integer not null default 0
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. PERMISOS — tabla nueva: anon FUERA, escritura solo del conector
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.gps_equipos      enable row level security;
alter table public.gps_posiciones   enable row level security;
alter table public.gps_dia          enable row level security;
alter table public.gps_sync_estado  enable row level security;

-- `anon` viaja en el bundle del navegador: no toca nada de esto, ni leer.
revoke all on public.gps_equipos     from anon;
revoke all on public.gps_posiciones  from anon;
revoke all on public.gps_dia         from anon;
revoke all on public.gps_sync_estado from anon;

grant select on public.gps_equipos, public.gps_posiciones,
                public.gps_dia, public.gps_sync_estado to authenticated;

-- LEER: oficina y auditoría. Verbo por verbo, nunca `for all`.
-- ⛔ A propósito SIN el escape `app_rol() is null`: en tablas viejas ese null era fail-open
--    para no trancar el sistema. Una tabla nueva no arrastra ese pasado — si el rol no se
--    resuelve, no lee. No estar en la lista no puede ser el único candado.
create policy gps_equipos_sel on public.gps_equipos
  for select to authenticated
  using ( app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','auditor']) );

create policy gps_posiciones_sel on public.gps_posiciones
  for select to authenticated
  using ( app_rol() = any(array['superadmin','admin','operador','visualizador','directivo','auditor']) );

create policy gps_dia_sel on public.gps_dia
  for select to authenticated
  using ( app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','auditor']) );

create policy gps_sync_estado_sel on public.gps_sync_estado
  for select to authenticated
  using ( app_rol() = any(array['superadmin','admin','directivo','auditor']) );

-- ESCRIBIR: nadie desde la app. Solo el conector, que corre con service_role y por
-- definición se salta la RLS. No se crea NINGUNA policy de insert/update/delete: el dato
-- del GPS es evidencia, y una evidencia que la oficina puede editar no prueba nada.

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and tablename like 'gps_%' order by tablename, cmd;
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_name like 'gps_%' and grantee in ('anon','authenticated');
--   → anon NO debe aparecer en ninguna fila.
