-- ═══════════════════════════════════════════════════════════════════════════════
-- `anomalias` — la falla que nadie resolvió TIENE que seguir viéndose mañana
-- 2026-08-11 · para las bases de FlotaMax demo, Flotilla y VIDECA
--
-- POR QUÉ
--   Betangar dejó atrás el modelo viejo el 2026-07-20: la pantalla de fallas leía
--   la fila del checklist de HOY, así que una falla reportada ayer y NO arreglada
--   DESAPARECÍA de la vista. Los clones nunca recibieron ese arreglo: su
--   `renderChecklistAnomalias` sigue leyendo `checklist`.
--
--   Con la tabla, una falla vive hasta que alguien la CIERRA, y arrastra los días
--   que lleva sin resolver — que es lo que el chofer ve en su celular.
--
-- IDÉNTICA A BETANGAR, a propósito: mismas columnas, mismos defaults, mismo índice
-- y mismas policies. Cinco productos que responden distinto a la misma pregunta es
-- justamente lo que se está corrigiendo esta semana.
--
-- ⚠️ SIN GRANTS A `anon`, y ahí SÍ se separa de Betangar.
--   Betangar le dejó a `anon` grants de INSERT/SELECT/UPDATE. Dos de esos ni
--   funcionan: no hay policy de UPDATE para `anon`, así que RLS lo niega igual —
--   un grant que nada puede usar. Y no hace falta ninguno: `chofer.html` hace
--   `signInWithPassword` (synthEmailUnidad) antes de escribir, o sea que el chofer
--   entra como `authenticated`, no como `anon`.
--   Tabla nueva ⇒ `anon` no toca nada. [[norma-tabla-nueva-revocar-anon]]
--
-- Y las policies van VERBO POR VERBO, no un FOR ALL. [[rls-verbo-por-verbo-no-for-all]]
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.anomalias (
  id                 uuid primary key default gen_random_uuid(),
  cam                text        not null,
  item               text        not null,
  item_norm          text        not null,
  label              text        not null,
  critico            boolean     default false,
  detalle            text        default '',
  origen             text        default 'chofer',
  reportado_por      text        default '',
  fecha_reporte      text        not null,
  visto_ultima_fecha text,
  veces              integer     default 1,
  estado             text        not null default 'abierta',
  resuelta_por       text,
  resuelta_at        timestamptz,
  nota_resolucion    text,
  created_at         timestamptz default now()
);

-- UNA sola falla abierta por unidad+ítem. Es lo que evita que el checklist de cada
-- mañana vuelva a abrir la misma falla, y lo que hace que se REFRESQUE en vez de
-- duplicarse. Parcial: una vez resuelta, la misma falla puede volver a abrirse.
create unique index if not exists anomalias_abierta_unica
  on public.anomalias (cam, item_norm) where (estado = 'abierta');
create index if not exists anomalias_cam_estado
  on public.anomalias (cam, estado);

alter table public.anomalias enable row level security;

-- ⛔ `anon` no entra. Ni grant ni policy.
revoke all on public.anomalias from anon;

grant select, insert, update, delete on public.anomalias to authenticated;

drop policy if exists anomalias_sel2 on public.anomalias;
drop policy if exists anomalias_ins2 on public.anomalias;
drop policy if exists anomalias_upd2 on public.anomalias;
drop policy if exists anomalias_del2 on public.anomalias;

create policy anomalias_sel2 on public.anomalias for select to authenticated using (true);
create policy anomalias_ins2 on public.anomalias for insert to authenticated with check (true);
create policy anomalias_upd2 on public.anomalias for update to authenticated using (true) with check (true);
-- Borrar es lo único restringido: pasa por el candado de la app (token + rol auditor).
create policy anomalias_del2 on public.anomalias for delete to authenticated using (app_puede_borrar());

-- ── Qué quedó (se devuelve: una migración que no hizo nada tiene que NOTARSE) ──
select
  (select count(*)::int from information_schema.columns
     where table_schema='public' and table_name='anomalias')                    as columnas,
  (select count(*)::int from pg_indexes  where tablename='anomalias')           as indices,
  (select count(*)::int from pg_policies where tablename='anomalias')           as policies,
  (select count(*)::int from information_schema.role_table_grants
     where table_schema='public' and table_name='anomalias' and grantee='anon') as grants_anon,
  (select relrowsecurity from pg_class where oid='public.anomalias'::regclass)  as rls;
