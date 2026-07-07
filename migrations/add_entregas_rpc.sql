-- FlotaMax - Entregas: RPCs SECURITY DEFINER para cerrar el hueco CRÍTICO de PII.
-- =====================================================================================
-- PROBLEMA (auditoría 2026-07-06, hallazgo #1 crítico):
--   add_entregas.sql:29 creó 'entregas_anon_all ... for all to anon using(true)'. La anon
--   key es PÚBLICA (recibir.html:52, chofer.html, app.js:11) y el sitio es público
--   (betangar.com / GitHub Pages), así que CUALQUIERA en internet puede:
--     - SELECT *  -> volcar TODA la PII (cliente, dirección, GPS, cédula, foto de cada entrega)
--     - UPDATE/DELETE -> falsear 'confirmada', borrar o inyectar entregas (destruye la prueba)
--   'entregas' NO está en migrations_rls_2c_revoke_anon.sql (por eso se coló).
--
-- POR QUÉ NO SE PUEDE SOLO REVOCAR ANON:
--   La app de entregas es 100% anon por diseño: el chofer registra SIN login y el receptor
--   confirma desde un link público. Se enrutan esas operaciones por estas funciones
--   SECURITY DEFINER, que devuelven SOLO columnas seguras y operan por 'token' (8 bytes
--   crypto = no adivinable). El 'id' (cam+timestamp) SÍ es adivinable: nunca es la llave.
--
-- ORDEN DE DESPLIEGUE:
--   1) Correr ESTE archivo (ADITIVO: no rompe el cliente viejo, que aún usa la policy anon).
--   2) Desplegar chofer.html + recibir.html (ya llaman a estas RPCs). Verificar en vivo.
--   3) Correr add_entregas_lockdown.sql (revoca el acceso directo de anon).
--
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm). Idempotente.

-- 1) Ver una entrega por token (recibir.html). No expone lat/lng/precision crudos.
--    La cédula (recibido_ci) solo se devuelve si YA está confirmada (el receptor la ve
--    tras confirmar, no antes).
create or replace function public.entrega_ver(p_token text)
returns table(
  id text, cam text, chofer text, cliente text, direccion text, direccion_gps text,
  tipo text, foto_url text, fecha date, hora text, estado text,
  recibido_por text, recibido_ci text
)
language sql security definer set search_path = public as $$
  select e.id, e.cam, e.chofer, e.cliente, e.direccion, e.direccion_gps,
         e.tipo, e.foto_url, e.fecha, e.hora, e.estado,
         case when e.estado = 'confirmada' then e.recibido_por else null end,
         case when e.estado = 'confirmada' then e.recibido_ci  else null end
  from public.entregas e
  where e.token = p_token
  limit 1;
$$;

-- 2) Confirmar recepción por token (recibir.html y chofer.html). Solo transiciona
--    'entregada' -> 'confirmada' (no puede re-confirmar ni tocar otra fila). Devuelve
--    true si confirmó, false si el token no existe / ya estaba confirmada / falta nombre.
create or replace function public.entrega_confirmar(
  p_token text,
  p_nombre text,
  p_ci text default '',
  p_via text default 'link',
  p_foto_url text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_token is null or length(p_token) < 8 or coalesce(trim(p_nombre),'') = '' then
    return false;
  end if;
  update public.entregas
     set estado      = 'confirmada',
         recibido_por = p_nombre,
         recibido_ci  = coalesce(p_ci, ''),
         recibido_at  = now(),
         confirm_via  = coalesce(p_via, 'link'),
         foto_url     = coalesce(p_foto_url, foto_url)
   where token = p_token
     and estado = 'entregada';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- 3) Registrar / re-subir una entrega (chofer.html). Idempotente por id para la cola
--    offline. El chofer es anon; esta función centraliza el insert y permite quitar la
--    policy anon amplia. Preserva la confirmación si ya existía (coalesce).
create or replace function public.entrega_registrar(p jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(p->>'id','');
begin
  if v_id = '' then
    return null;
  end if;
  insert into public.entregas as e (
    id, cam, chofer, cliente, direccion, tipo, lat, lng, precision_gps,
    direccion_gps, foto_url, fecha, hora, estado, token,
    recibido_por, recibido_ci, recibido_at, confirm_via
  ) values (
    v_id, p->>'cam', p->>'chofer', p->>'cliente', p->>'direccion', p->>'tipo',
    nullif(p->>'lat','')::double precision, nullif(p->>'lng','')::double precision,
    nullif(p->>'precision_gps','')::double precision,
    p->>'direccion_gps', p->>'foto_url', nullif(p->>'fecha','')::date, p->>'hora',
    coalesce(nullif(p->>'estado',''),'entregada'), p->>'token',
    p->>'recibido_por', p->>'recibido_ci',
    nullif(p->>'recibido_at','')::timestamptz, p->>'confirm_via'
  )
  on conflict (id) do update set
    cliente       = excluded.cliente,
    direccion     = excluded.direccion,
    tipo          = excluded.tipo,
    lat           = excluded.lat,
    lng           = excluded.lng,
    precision_gps = excluded.precision_gps,
    direccion_gps = excluded.direccion_gps,
    foto_url      = excluded.foto_url,
    estado        = excluded.estado,
    recibido_por  = coalesce(excluded.recibido_por, e.recibido_por),
    recibido_ci   = coalesce(excluded.recibido_ci,  e.recibido_ci),
    recibido_at   = coalesce(excluded.recibido_at,  e.recibido_at),
    confirm_via   = coalesce(excluded.confirm_via,  e.confirm_via);
  return v_id;
end;
$$;

-- 4) Lista del día por unidad (chofer.html renderEntregasHoy). Columnas seguras + token
--    (el chofer necesita el token para reenviar el link de su propia unidad).
create or replace function public.entregas_del_dia(p_cam text, p_fecha date)
returns table(
  id text, cam text, chofer text, cliente text, direccion text, direccion_gps text,
  tipo text, foto_url text, fecha date, hora text, estado text, token text,
  recibido_por text, recibido_ci text
)
language sql security definer set search_path = public as $$
  select e.id, e.cam, e.chofer, e.cliente, e.direccion, e.direccion_gps,
         e.tipo, e.foto_url, e.fecha, e.hora, e.estado, e.token,
         e.recibido_por, e.recibido_ci
  from public.entregas e
  where e.cam = p_cam
    and e.fecha = p_fecha
  order by e.hora desc;
$$;

-- Permisos: solo estas funciones (no la tabla) quedan al alcance de anon.
revoke all on function public.entrega_ver(text)                              from public;
revoke all on function public.entrega_confirmar(text,text,text,text,text)    from public;
revoke all on function public.entrega_registrar(jsonb)                       from public;
revoke all on function public.entregas_del_dia(text,date)                    from public;
grant execute on function public.entrega_ver(text)                           to anon, authenticated;
grant execute on function public.entrega_confirmar(text,text,text,text,text) to anon, authenticated;
grant execute on function public.entrega_registrar(jsonb)                    to anon, authenticated;
grant execute on function public.entregas_del_dia(text,date)                 to anon, authenticated;
