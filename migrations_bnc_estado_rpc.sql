-- ─────────────────────────────────────────────────────────────────────────────
-- BNC: EL ESTADO SE PIDE POR FUNCIÓN, NO POR UNA VISTA QUE SE SALTABA EL RLS.
--                                                              2026-07-27
--
-- ⛔ LO QUE SE ENCONTRÓ, y está probado. `bnc_config_estado` no tenía
-- `security_invoker`, así que corría con los permisos de su dueño y SE SALTABA
-- el RLS de `bnc_config`:
--
--     (como role authenticated)
--     bnc_config        → 0 filas   el RLS `solo_service_role` aguanta
--     bnc_config_estado → 1 fila    la vista pasaba por encima
--
-- Y en esta base conviven Geppetto, Ranita, Betangar y MaxPersonal. Hay 17
-- usuarios con rol `representante` —padres de alumnos de los colegios— que
-- podían leer el estado bancario de Betangar. La vista enmascara a propósito
-- (••••1234), así que NO fugaban las llaves completas; sí fugaban que existen,
-- el client_id, la base_url, la cuenta y el teléfono de pago móvil.
--
-- ⛔ Y PEOR: `authenticated` tenía SELECT, INSERT, UPDATE, DELETE y TRUNCATE
-- sobre la tabla de credenciales bancarias. Lo único que lo salvaba era el RLS.
-- Una política mal escrita —o un `disable row level security` en una migración
-- apurada— y quedaba abierta la tabla con las llaves del banco.
--
-- ── EL ORDEN EN QUE SE APLICÓ (importa) ─────────────────────────────────────
--  1. Se creó `bnc_estado()`           ← aditivo, no rompe nada
--  2. app.js pasó a usarla y se publicó en betangar.com  ← verificado en vivo
--  3. Recién ahí se cerró la vista y se revocó la tabla
-- Al revés, Betangar habría creído que no tiene credenciales y se le caía la
-- compuerta de pagos.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.bnc_estado()
returns table (
  id uuid, tiene_credenciales boolean,
  client_guid_masked text, master_key_masked text,
  cuenta text, telefono_pm text, moneda text,
  url_notificacion_dev text, url_notificacion_prod text,
  tiene_working_key boolean,
  -- ⚠️ En `bnc_config` esto es TEXTO, no una fecha. Declararlo `timestamptz`
  -- reventaba la función entera con "structure of query does not match".
  working_key_fecha text,
  activo boolean, updated_at timestamptz, client_id text, base_url text
)
language plpgsql security definer stable
set search_path to 'public', 'auth', 'pg_temp'
as $fn$
declare v_rol text;
begin
  -- El rol sale del TOKEN, no de una tabla que el navegador pueda influir.
  v_rol := coalesce((auth.jwt() -> 'user_metadata' ->> 'rol'),
                    (auth.jwt() -> 'app_metadata'  ->> 'rol'));

  -- ⛔ En `PERMISOS` de app.js solo `superadmin` y `admin` abren la pantalla
  -- BNC. Ese candado vivía SOLO en el JavaScript — y el JavaScript se salta
  -- abriendo la consola del navegador.
  if v_rol is null or v_rol not in ('superadmin','admin') then
    raise exception 'La configuracion bancaria la ve quien administra.';
  end if;

  return query
    select c.id,
           c.client_guid is not null and length(coalesce(c.client_guid,'')) > 0
             and c.master_key is not null and length(coalesce(c.master_key,'')) > 0,
           case when c.client_guid is not null and length(c.client_guid) >= 4
                then '••••' || right(c.client_guid, 4) end,
           case when c.master_key is not null and length(c.master_key) >= 4
                then '••••' || right(c.master_key, 4) end,
           c.cuenta, c.telefono_pm, c.moneda,
           c.url_notificacion_dev, c.url_notificacion_prod,
           c.working_key is not null and length(coalesce(c.working_key,'')) > 0,
           c.working_key_fecha, c.activo, c.updated_at, c.client_id, c.base_url
      from bnc_config c
     order by c.updated_at desc nulls last;
end $fn$;

revoke all on function public.bnc_estado() from public, anon;
grant execute on function public.bnc_estado() to authenticated;

-- ⚠️ La vista NO se borra: si algo que no vimos todavía la consulta, con
-- security_invoker devuelve 0 filas —se entera y se arregla— en vez de un 404
-- que tumba una pantalla entera.
alter view public.bnc_config_estado set (security_invoker = on);

revoke all on public.bnc_config from authenticated;

-- ── COMPROBADO (no asumido) ─────────────────────────────────────────────────
--   representante → tabla: sin permiso · vista: 0 · rpc: rechazado
--   operador      → rpc: rechazado
--   superadmin    → rpc: 1 fila, llave ••••d937
