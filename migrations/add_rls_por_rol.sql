-- ════════════════════════════════════════════════════════════════════════════
-- RLS POR ROL (auditoría venta - crítico #3) — SEGREGACIÓN DE FUNCIONES a nivel de DATOS.
-- Objetivo (según lo que Máximo quiere lograr, NO el librito):
--   • NO romper la operación: el equipo de OFICINA (admin/operador/rrhh/...) sigue viendo todo.
--   • Cerrar el hueco real: los roles OPERATIVOS/kiosco (vigilante/mecanico/asistencia/operativo)
--     NO pueden leer/editar sueldos, cuentas, pagos, préstamos, etc. pegándole directo a la API.
-- Diseño SEGURO: el rol se lee de btg_usuarios (NO del JWT, que el usuario podría falsear).
--   Fail-open: si el rol es desconocido (null) → PERMITIDO (no tranca a nadie del equipo).
--   Solo los roles operativos quedan DENEGADOS en las tablas sensibles.
-- Las tablas OPERATIVAS (porteria, checklist, planillas, combustible, etc.) quedan IGUAL (abiertas
--   a authenticated) porque los roles operativos las necesitan.
-- Reversible: ver bloque ROLLBACK al final.
-- Correr en Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Rol real del usuario actual (desde btg_usuarios, no del JWT). STABLE+DEFINER = rápido y seguro.
create or replace function public.app_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.btg_usuarios where auth_user_id = auth.uid() limit 1;
$$;
revoke all on function public.app_rol() from anon, public;
grant execute on function public.app_rol() to authenticated;

-- 2) Política por rol en tablas SENSIBLES (dinero + datos personales).
do $$
declare
  t text;
  sensibles text[] := array[
    'abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos',
    'caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables',
    'multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'
  ];
  -- Roles de OFICINA permitidos (o rol desconocido = fail-open, para no romper operación).
  cond text := $c$ (app_rol() is null or app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh'])) $c$;
begin
  foreach t in array sensibles loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      execute format('drop policy if exists btg_auth_all on public.%I', t);
      execute format('drop policy if exists btg_rol_oficina on public.%I', t);
      execute format('create policy btg_rol_oficina on public.%I for all to authenticated using (%s) with check (%s)', t, cond, cond);
    end if;
  end loop;
end $$;

-- VERIFICACIÓN (correr aparte para confirmar):
--   select public.app_rol();  -- (en el editor da null; probar en la app logueado)
--   select tablename, policyname from pg_policies where schemaname='public' and policyname='btg_rol_oficina' order by tablename;
--   select count(*) filter (where auth_user_id is not null) con_auth, count(*) total from btg_usuarios;  -- auth_user_id debe estar poblado

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si algo se rompe, volver a la política abierta): descomentar y correr.
-- do $$
-- declare t text;
--   sensibles text[] := array['abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos','caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables','multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'];
-- begin
--   foreach t in array sensibles loop
--     if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
--       execute format('drop policy if exists btg_rol_oficina on public.%I', t);
--       execute format('create policy btg_auth_all on public.%I for all to authenticated using (true) with check (true)', t);
--     end if;
--   end loop;
-- end $$;
-- ════════════════════════════════════════════════════════════════════════════
