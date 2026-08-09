-- EL INFORME FINANCIERO, SOLO PARA LOS SOCIOS — Y CON CANDADO, NO CON UN MENÚ ESCONDIDO.
--
-- Máximo (09/08): «quiero que solo pueda verlo el rol de socio, más nadie por ahora» y, al
-- repasar la lista: «los superadmin, visualizador y director sí pueden verlo, está bien».
-- Quedan FUERA `admin` y `operador`, que hoy sí lo ven (3 cuentas: cristinaehm, operador1,
-- operador2), además de rrhh, mecánico, operativo, vigilante, asistencia y las demo.
--
-- ⛔ QUITARLO DEL MENÚ NO ES UN CANDADO. Las 8 funciones del informe son SECURITY DEFINER (corren
-- como el dueño, ignorando RLS) y están concedidas a `authenticated`. Comprobado en vivo, no
-- supuesto: con `set local role authenticated`, `btg_resumen_socio` devuelve la utilidad completa.
-- O sea que HOY el vigilante, el mecánico, asistencia y las cuentas demo pueden pedir el estado de
-- resultados entero desde la consola del navegador. El menú solo decide qué se ve, no qué se puede
-- pedir. [[norma-seguridad-dos-niveles]] · [[norma-barrido-no-es-candado]] ·
-- [[norma-permiso-que-ninguna-pantalla-muestra]]
--
-- ⚠️ NO existe un rol «socios» en esta base: se verificó contra btg_usuarios antes de escribir
-- esto. Los socios son `superadmin` (frankbetangar, maxbetangar). Inventar el rol habría dejado el
-- candado cerrado para TODOS, incluidos ellos — y se habría visto como «no hay datos».
-- La función NO se llama `es_socio` porque no lo son los tres: se llama por lo que hace.
-- La auditoría interna no entra por acá: su edge function corre con `service_role`.

create or replace function public.btg_ve_financiero()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.app_rol() in ('superadmin','visualizador','directivo'), false);
$$;
comment on function public.btg_ve_financiero() is
  'Quien puede ver el estado de resultados: superadmin (los socios), visualizador y directivo.';

-- Levanta error en vez de devolver vacío: una lista vacía se lee como «no hay datos» y esconde que
-- la puerta estaba cerrada. Que se note. [[norma-numero-que-el-dueno-no-puede-explicar]]
create or replace function public.btg_exige_financiero()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.btg_ve_financiero() then
    raise exception 'El informe financiero no está disponible para este usuario.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.btg_ve_financiero() from public, anon;
revoke all on function public.btg_exige_financiero() from public, anon;
grant execute on function public.btg_ve_financiero() to authenticated;
grant execute on function public.btg_exige_financiero() to authenticated;

-- ⛔ EL CANDADO NO PUEDE TRANCAR A LAS PIEZAS AUTOMÁTICAS.
-- La primera versión miraba solo app_rol(), que sale de auth.uid(). La auditoría interna corre con
-- service_role y NO tiene auth.uid(): app_rol() devuelve null y la habría bloqueado. Se habría
-- descubierto a las 6 de la mañana, o peor, no se habría descubierto — el informe mensual dejaba
-- de llegar y el silencio se ve igual que "todo en orden".
-- [[norma-candado-que-rompe-la-herramienta]] · [[norma-mirar-la-ultima-corrida-no-la-existencia]]
create or replace function public.btg_ve_financiero()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select current_user in ('service_role','postgres','supabase_admin')
      or coalesce(public.app_rol() in ('superadmin','visualizador','directivo'), false);
$$;

-- ⛔ DENTRO DE UNA FUNCIÓN SECURITY DEFINER, `current_user` ES EL DUEÑO, NO QUIEN LLAMA.
-- La versión anterior comprobaba current_user in ('service_role','postgres',...) y por eso se
-- APROBABA A SÍ MISMA: probado en vivo, un authenticated sin permiso recibía las 24 filas del
-- estado financiero igual que antes. El candado existía y no cerraba nada.
-- Lo que sí sobrevive al SECURITY DEFINER es el JWT: auth.role() dice con qué llave se entró.
create or replace function public.btg_ve_financiero()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role() = 'service_role', false)
      or coalesce(public.app_rol() in ('superadmin','visualizador','directivo'), false);
$$;
