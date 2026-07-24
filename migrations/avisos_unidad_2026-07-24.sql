-- BETANGAR — canal de AVISO por unidad para la PWA del chofer (anon), que caduca solo
-- Fecha: 2026-07-24
--
-- Necesidad: mandarle a UNA unidad un mensaje puntual desde administración (ej.
-- "corregimos tu kilometraje, registrá el real mañana") que se vea en su app (QR),
-- también sin señal, y que DESAPAREZCA solo al pasar su fecha `hasta`.
--
-- El chofer entra ANON (chofer.html usa la anon key). NO puede leer `configuracion`
-- (cerrada a anon a propósito). Por eso el aviso va en una tabla propia, expuesta SOLO
-- a través de una RPC SECURITY DEFINER que devuelve únicamente los avisos VIGENTES de
-- esa unidad (nunca lista toda la tabla ni datos de otras unidades).

begin;

create table if not exists public.avisos_unidad (
  id         bigint generated always as identity primary key,
  cam        text not null,
  titulo     text,
  mensaje    text not null,
  hasta      date not null,                 -- último día que se muestra (VE)
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists avisos_unidad_cam_hasta on public.avisos_unidad(cam, hasta);

-- RLS: la tabla NO se expone directamente a nadie (ni anon ni authenticated).
-- Se lee solo por la RPC (SECURITY DEFINER). La oficina la administra por service_role
-- o por SQL. Así el chofer no puede leer avisos de otras unidades ni escribir.
alter table public.avisos_unidad enable row level security;
revoke all on public.avisos_unidad from anon, authenticated;

-- RPC: devuelve el aviso vigente (hasta >= hoy VE) más reciente de UNA unidad.
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

-- Aviso concreto para JAC-B008 (corrección de km del 24/07). SOLO POR HOY (caduca el 24/07):
-- es solo para que el chofer sepa que quedó resuelto. Además el banner trae un botón "Entendido ✓"
-- (avisoDescartar en chofer.html) para que él lo quite apenas lo lea (se recuerda, no reaparece).
insert into public.avisos_unidad(cam, titulo, mensaje, hasta, creado_por)
values (
  'JAC-B008',
  'Kilometraje corregido ✅',
  'Ya resolvimos el inconveniente del kilometraje de tu unidad. Cuando registres, coloca el KM REAL que marca el tablero (aunque sea menor al que quedó ayer): el sistema ya lo acepta. ¡Gracias!',
  '2026-07-24',
  'sistema (correccion km)'
);
