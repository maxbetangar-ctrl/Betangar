-- ════════════════════════════════════════════════════════════════════════════
-- FIX C2 (auditoría Fable 5, 2026-07-04) — RLS por comando en las 18 tablas sensibles.
-- LECTURA: oficina + rol null (fail-open, nadie pierde vista). Operativos NO.
-- ESCRITURA (ins/upd/del): solo roles que escriben a diario. NO visualizador. NO null.
-- Cierra: visualizador ya no escribe dinero por API; cuenta sin rol tampoco (sí lee).
-- No cambia el trabajo de admin/operador/rrhh/directivo. Reversible (ROLLBACK abajo).
-- Salta las VISTAS (bnc_config_estado) con el filtro BASE TABLE (no admiten create policy).
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  s text[] := array[
    'abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones',
    'bnc_movimientos','caja_chica','caja_chica_reposiciones','contratos',
    'cxp','empleados','gastos_variables','multas','nomina_historial',
    'pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'
  ];
  r text := 'app_rol() is null or app_rol() = any(array[''superadmin'',''admin'',''operador'',''rrhh'',''visualizador'',''directivo'',''demo_admin'',''demo_operador'',''demo_rrhh''])';
  w text := 'app_rol() = any(array[''superadmin'',''admin'',''operador'',''rrhh'',''directivo'',''demo_admin'',''demo_operador'',''demo_rrhh''])';
  q text;
begin
  foreach t in array s loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      q := quote_ident(t);
      execute 'drop policy if exists btg_auth_all on public.'||q;
      execute 'drop policy if exists btg_rol_oficina on public.'||q;
      execute 'drop policy if exists btg_rol_lectura on public.'||q;
      execute 'drop policy if exists btg_rol_ins on public.'||q;
      execute 'drop policy if exists btg_rol_upd on public.'||q;
      execute 'drop policy if exists btg_rol_del on public.'||q;
      execute 'create policy btg_rol_lectura on public.'||q||' for select to authenticated using ('||r||')';
      execute 'create policy btg_rol_ins on public.'||q||' for insert to authenticated with check ('||w||')';
      execute 'create policy btg_rol_upd on public.'||q||' for update to authenticated using ('||w||') with check ('||w||')';
      execute 'create policy btg_rol_del on public.'||q||' for delete to authenticated using ('||w||')';
    end if;
  end loop;
end $$;

-- VERIFICAR (correr aparte):
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and policyname like 'btg_rol_%' order by tablename, cmd;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (volver a la política única abierta): descomentar y correr.
-- do $$
-- declare t text; q text;
--   s text[] := array['abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos','caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables','multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'];
--   c text := 'app_rol() is null or app_rol() = any(array[''superadmin'',''admin'',''operador'',''rrhh'',''visualizador'',''directivo'',''demo_admin'',''demo_operador'',''demo_rrhh''])';
-- begin
--   foreach t in array s loop
--     if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
--       q := quote_ident(t);
--       execute 'drop policy if exists btg_rol_lectura on public.'||q;
--       execute 'drop policy if exists btg_rol_ins on public.'||q;
--       execute 'drop policy if exists btg_rol_upd on public.'||q;
--       execute 'drop policy if exists btg_rol_del on public.'||q;
--       execute 'create policy btg_rol_oficina on public.'||q||' for all to authenticated using ('||c||') with check ('||c||')';
--     end if;
--   end loop;
-- end $$;
-- ════════════════════════════════════════════════════════════════════════════
