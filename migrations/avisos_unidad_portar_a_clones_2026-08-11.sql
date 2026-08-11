-- ═══════════════════════════════════════════════════════════════════════════════
-- `avisos_unidad` — canal de aviso a UNA unidad, que caduca solo
-- 2026-08-11 · para las bases de FlotaMax demo, Flotilla y VIDECA
--
-- QUÉ ES
--   Un mensaje puntual de administración para UN camión, que se ve en la app del
--   chofer (banner verde, no rojo: no es una falla), también SIN SEÑAL, y que
--   DESAPARECE solo al pasar su fecha `hasta`. Nadie tiene que acordarse de
--   apagarlo. En Betangar se usó para: «corregimos tu kilometraje, registrá el
--   real» — decirle algo al chofer justo cuando va a hacer la tarea, en vez de
--   por WhatsApp o de boca en boca.
--
-- CÓMO ESTÁ PROTEGIDO — y es lo que vale la pena copiar tal cual
--   La tabla NO se expone a nadie: ni `anon` ni `authenticated`. Se lee ÚNICAMENTE
--   por la RPC `aviso_unidad(p_cam)`, SECURITY DEFINER, que devuelve solo el aviso
--   VIGENTE de ESA unidad. Nunca lista la tabla entera ni deja ver el aviso de otro
--   camión, y el chofer no puede escribir nada.
--   [[norma-cliente-final-lista-blanca]] [[norma-tabla-nueva-revocar-anon]]
--
-- ⚠️ LO QUE NO TRAE: pantalla de oficina.
--   Igual que en Betangar, hoy un aviso solo se crea por SQL o por service_role.
--   Se porta la pieza tal como está, y la pantalla queda pendiente y dicho.
--
-- ⚠️ Y NO se copia el `insert` de la B008 de Betangar: ese es un dato suyo, de una
--   corrección del 24/07 y ya vencido. Un clon no hereda los datos del original.
--   [[clon-hereda-personas-y-secretos]]
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.avisos_unidad (
  id         bigint generated always as identity primary key,
  cam        text not null,
  titulo     text,
  mensaje    text not null,
  hasta      date not null,                 -- último día que se muestra (hora VE)
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists avisos_unidad_cam_hasta on public.avisos_unidad(cam, hasta);

alter table public.avisos_unidad enable row level security;
revoke all on public.avisos_unidad from anon, authenticated;

create or replace function public.aviso_unidad(p_cam text)
returns table(titulo text, mensaje text, hasta date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.titulo, a.mensaje, a.hasta
  from public.avisos_unidad a
  where a.cam = p_cam
    and a.hasta >= ((now() at time zone 'America/Caracas')::date)
  order by a.created_at desc
  limit 1;
$$;

revoke execute on function public.aviso_unidad(text) from public;
grant execute on function public.aviso_unidad(text) to anon, authenticated;

commit;

-- ── Qué quedó (se devuelve: una migración que no hizo nada tiene que NOTARSE) ──
select
  (select count(*)::int from information_schema.columns
     where table_schema='public' and table_name='avisos_unidad')                     as columnas,
  (select relrowsecurity from pg_class where oid='public.avisos_unidad'::regclass)   as rls,
  (select count(*)::int from information_schema.role_table_grants
     where table_schema='public' and table_name='avisos_unidad'
       and grantee in ('anon','authenticated'))                                      as grants_expuestos,
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='aviso_unidad' and p.prosecdef)          as rpc_security_definer,
  (select count(*)::int from avisos_unidad)                                          as avisos;
