-- ════════════════════════════════════════════════════════════════════════════
-- RPC `marca_publica()` — la marca del clon, leible ANTES de iniciar sesion
--
-- POR QUE UN RPC Y NO LEER LA TABLA: el logo y el nombre salen en la pantalla de
-- login, o sea que hay que poder leerlos SIN sesion. Pero `configuracion` guarda
-- secretos (token de Wassenger, credenciales del banco), asi que abrirla a `anon`
-- seria un disparate. Esta funcion devuelve UNICAMENTE la fila clave='marca'.
--
-- Lista BLANCA por construccion: no filtra "todo menos los secretos" —devuelve
-- una sola fila conocida—. Si manana se agrega una clave con un secreto nuevo, no
-- se cuela sola. Misma leccion que marca-publica.js de EduControl.
--
-- Devuelve JSON vacio si no hay fila: el front cae a lo que tenga en BTG_CONFIG.
-- Aplicada por MCP el 2026-07-26 en la base molde y en la del demo.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.marca_publica()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select valor::jsonb from public.configuracion where clave = 'marca' limit 1),
    '{}'::jsonb
  );
$$;

-- Preservar ANTES de revocar a PUBLIC: revocar sin preservar se lleva por delante
-- a authenticated y tumba la app de oficina (leccion 2026-07-19).
grant execute on function public.marca_publica() to anon, authenticated, service_role;
revoke execute on function public.marca_publica() from public;
