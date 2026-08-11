-- ⛔ LO QUE LA APP LE PIDE AL TELÉFONO DE OTRO SE MIDE, NO SE SUPONE.
-- Fecha: 2026-08-11
--
-- POR QUÉ EXISTE. El 03/08 la foto del surtido pasó de la cámara del teléfono (`input file`) a la
-- cámara DENTRO de la página (`getUserMedia`). Eso le puso al equipo del chofer un requisito que
-- antes no hacía falta: el permiso de cámara del navegador. Melvin Barboza (JAC-B004) registró su
-- última surtida el 01/08 y no volvió a registrar ninguna. Diez días. Nos enteramos el 11/08 por un
-- WhatsApp suyo — no por el sistema.
--
-- El teléfono YA SABE que el permiso está negado desde que abre la pantalla: `navigator.permissions`
-- lo dice. Hasta hoy eso solo se le mostraba AL CHOFER, que es justamente el que no puede
-- arreglarlo solo (en el caso de Omar, 08/08, el corte estaba en el permiso que Android le da a
-- Chrome). La oficina no se enteraba nunca.
--
-- Esto no es de Betangar: es de los 20 clientes que vienen. La MEDICIÓN vive en `permisos.js`, que
-- ya es el mismo archivo en todos los productos; acá va solo dónde se guarda y quién puede escribir.
--
-- FORMA (calcada de `avisos_unidad`, 24/07): la tabla no se expone a NADIE —ni anon ni
-- authenticated—; se escribe solo por una RPC SECURITY DEFINER que valida qué entra. El chofer de
-- Betangar aseo entra ANON (chofer.html sin login), así que la RPC es su única puerta.
-- [[norma-tabla-nueva-revocar-anon]] [[norma-seguridad-dos-niveles]]

begin;

create table if not exists public.dispositivo_permisos (
  cam        text not null,
  permiso    text not null,                  -- 'camera' | 'geolocation'
  estado     text not null,                  -- 'denied' | 'prompt' | 'granted'
  navegador  text,                           -- lo que la persona VE en su teléfono ('Chrome', 'Safari'…)
  visto_at   timestamptz not null default now(),
  primary key (cam, permiso)                 -- UNA fila por unidad y permiso: la tabla no crece sola
);

-- La tabla NO se expone directamente. Se escribe por la RPC; la oficina y el aviso diario leen
-- por service_role. Sin grants, `anon` no puede ni listar qué unidades hay.
alter table public.dispositivo_permisos enable row level security;
revoke all on public.dispositivo_permisos from anon, authenticated;

-- ── RPC: el teléfono reporta el estado de UN permiso de SU unidad ──────────────────────────────
-- Valida todo del lado del servidor, porque quien llama es un cliente público:
--   • el permiso y el estado tienen que ser de la lista (si no, no se escribe nada);
--   • la unidad tiene que EXISTIR (si no, cualquiera podría llenar la tabla de filas inventadas);
--   • el nombre del navegador se recorta: es texto libre que viene del cliente.
-- No devuelve nada y NUNCA levanta excepción por dato inválido: esto corre al abrir la pantalla del
-- chofer y no puede, en ningún caso, dejarlo sin trabajar por un aviso que es para la oficina.
create or replace function public.permiso_reportar(
  p_cam text, p_permiso text, p_estado text, p_nav text default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cam is null or btrim(p_cam) = '' then return; end if;
  if p_permiso not in ('camera', 'geolocation') then return; end if;
  if p_estado  not in ('denied', 'prompt', 'granted') then return; end if;
  if not exists (select 1 from public.km_data      k where k.cam = p_cam)
     and not exists (select 1 from public.unidad_config u where u.cam = p_cam) then return; end if;

  insert into public.dispositivo_permisos as d (cam, permiso, estado, navegador, visto_at)
  values (p_cam, p_permiso, p_estado, left(nullif(btrim(coalesce(p_nav, '')), ''), 40), now())
  on conflict (cam, permiso) do update
    set estado = excluded.estado, navegador = excluded.navegador, visto_at = excluded.visto_at;
end;
$$;

-- ⚠️ El `revoke from public` NO alcanza donde hay un grant DIRECTO a `anon` sobre todas las
-- funciones (así nació expuesta la RPC de avisos en VIDECA el 11/08). Por eso el grant se declara
-- explícito y acotado: solo estos dos roles, solo esta firma.
revoke execute on function public.permiso_reportar(text, text, text, text) from public;
grant  execute on function public.permiso_reportar(text, text, text, text) to anon, authenticated;

commit;
