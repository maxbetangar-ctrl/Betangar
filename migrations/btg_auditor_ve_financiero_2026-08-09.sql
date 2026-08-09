-- Se agrega `auditor` al candado. Máximo (09/08), al plantearle la contradicción: "agrégala".
-- Contexto: app.js hace PERMISOS.auditor = PERMISOS.superadmin.slice(), así que el auditor YA tenía
-- el módulo del informe en el menú, pero btg_ve_financiero() no lo admitía: veía la pantalla y al
-- abrirla le decía que no estaba disponible. Ahora las dos capas dicen lo mismo.
-- Es coherente con el rol: audita las cuentas, y no puede auditar lo que no puede ver.
create or replace function public.btg_ve_financiero()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role() = 'service_role', false)
      or coalesce(public.app_rol() in ('superadmin','visualizador','directivo','auditor'), false);
$$;
