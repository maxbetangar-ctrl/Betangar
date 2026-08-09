-- ============================================================================
-- Betangar · el registro de CADA corrida del traído del banco
-- 2026-08-09.
--
-- POR QUÉ EXISTE UNA TABLA SOLO PARA ESTO
-- Un traído automático que se cae no se ve: la pantalla sigue mostrando los
-- movimientos de siempre y todo parece en orden. Ya nos pasó con el sync de
-- Geppetto, que se cae en silencio. La regla de la casa es que **un canal de
-- entrega caído se ve igual que todo en orden**, y la única forma de romper esa
-- ambigüedad es dejar constancia de cada corrida —incluidas las que no
-- trajeron nada— para que algo externo pueda mirar el silencio.
--
-- Se guarda TAMBIÉN la corrida que falla. Si solo se guardaran las buenas, una
-- racha de fallos se vería igual que "todavía no le tocó correr".
-- ============================================================================

create table if not exists bnc_sync_log (
  id            bigserial primary key,
  inicio        timestamptz not null default now(),
  fin           timestamptz,
  origen        text not null default 'cron',   -- 'cron' | 'manual' | 'pantalla'
  desde         text,                            -- ventana pedida al banco
  hasta         text,
  cuentas_ok    integer not null default 0,
  cuentas_mal   integer not null default 0,
  traidos       integer not null default 0,      -- lo que devolvió el banco
  nuevos        integer not null default 0,      -- lo que NO estaba y entró
  error         text,                            -- null = salió bien
  detalle       jsonb
);

comment on table bnc_sync_log is
  'Una fila por corrida del traído del banco, salga bien o mal. Es lo que mira el vigilante para saber si sigue vivo.';
comment on column bnc_sync_log.traidos is
  'Movimientos que devolvió el banco en la ventana. Puede ser alto y `nuevos` cero: es lo normal, la ventana se solapa a propósito.';
comment on column bnc_sync_log.nuevos is
  'Los que de verdad entraron. Cero NO es un fallo: quiere decir que ya estaban todos.';
comment on column bnc_sync_log.error is
  'null = salió bien. Las corridas fallidas TAMBIÉN se guardan: sin ellas, una racha de fallos se ve igual que "no le tocó correr".';

create index if not exists ix_bnc_sync_inicio on bnc_sync_log (inicio desc);

alter table bnc_sync_log enable row level security;
revoke all on bnc_sync_log from anon, public;
grant select, insert, update on bnc_sync_log to authenticated;

do $$
begin
  drop policy if exists btg_rol_lectura on bnc_sync_log;
  drop policy if exists btg_rol_ins on bnc_sync_log;
  drop policy if exists btg_rol_upd on bnc_sync_log;
  create policy btg_rol_lectura on bnc_sync_log for select to authenticated
    using (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh']));
  create policy btg_rol_ins on bnc_sync_log for insert to authenticated
    with check (app_rol() = any (array['superadmin','auditor','admin','operador','directivo']));
  create policy btg_rol_upd on bnc_sync_log for update to authenticated
    using (app_rol() = any (array['superadmin','auditor','admin','operador','directivo']))
    with check (app_rol() = any (array['superadmin','auditor','admin','operador','directivo']));
end $$;

-- ---------------------------------------------------------------------------
-- Lo que el vigilante consulta. Función y no consulta suelta, para que la
-- pregunta «¿esto sigue vivo?» tenga UNA sola definición.
-- ---------------------------------------------------------------------------
create or replace function bnc_sync_estado()
returns table (
  ultima_ok        timestamptz,
  horas_sin_ok     numeric,
  ultima_corrida   timestamptz,
  corridas_24h     integer,
  fallidas_24h     integer,
  nuevos_24h       integer,
  ultimo_error     text
)
language sql
security definer
set search_path = public
as $$
  select
    (select max(inicio) from bnc_sync_log where error is null),
    round(extract(epoch from (now() - coalesce((select max(inicio) from bnc_sync_log where error is null), now() - interval '99 days'))) / 3600.0, 1),
    (select max(inicio) from bnc_sync_log),
    (select count(*)::int from bnc_sync_log where inicio > now() - interval '24 hours'),
    (select count(*)::int from bnc_sync_log where inicio > now() - interval '24 hours' and error is not null),
    (select coalesce(sum(nuevos),0)::int from bnc_sync_log where inicio > now() - interval '24 hours'),
    (select error from bnc_sync_log where error is not null order by inicio desc limit 1)
$$;

revoke all on function bnc_sync_estado() from anon, public;
grant execute on function bnc_sync_estado() to authenticated;

comment on function bnc_sync_estado() is
  '¿El traído del banco sigue vivo? horas_sin_ok es lo que mira el vigilante. Una sola definición de la pregunta.';
