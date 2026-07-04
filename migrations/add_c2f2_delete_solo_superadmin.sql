-- ════════════════════════════════════════════════════════════════════════════
-- C2 Fase 2 · PASO 3 (lote 1) — DELETE de plata SOLO superadmin.
--
-- Cierra el bypass: un admin/operador/rrhh/directivo NO puede BORRAR registros de
-- plata por API directa. El borrado de esas tablas es SOLO por token (aprobación),
-- y al aprobar lo aplica el superadmin (maxbetangar/frankbetangar) → sigue funcionando.
-- El callback del solicitante que borra directo ahora recibe 403, pero es SILENCIOSO
-- (solo console.error, sin toast) y la fila ya la borró el superadmin al aprobar.
--
-- Tablas de este lote (verificado: su ÚNICO delete es por token, sin borrados diarios):
--   prestamos, multas, gastos_variables, gastos_fijos, contratos, abonos.
-- (planillas/empleados/gasol/gasoil quedan para otro lote — tienen borrados diarios
--  o toasts de error que hay que manejar aparte.)
--
-- Solo cambia la política de DELETE. INSERT/UPDATE/SELECT quedan igual (crear y editar
-- del día a día siguen funcionando). Reversible (rollback abajo).
-- ⚠️ NO toca BNC ni tablas de chofer. Correr en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  t text; q text;
  s text[] := array['prestamos','multas','gastos_variables','gastos_fijos','contratos','abonos'];
begin
  foreach t in array s loop
    if exists(select 1 from information_schema.tables
              where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      q := quote_ident(t);
      execute 'alter table public.'||q||' enable row level security';
      execute 'drop policy if exists btg_rol_del on public.'||q;
      execute 'drop policy if exists btg_del_superadmin on public.'||q;
      execute 'create policy btg_del_superadmin on public.'||q||
              ' for delete to authenticated using (app_rol() = ''superadmin'')';
    end if;
  end loop;
end $$;

-- VERIFICAR (correr aparte): debe listar btg_del_superadmin en las 6 tablas.
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and policyname='btg_del_superadmin' order by tablename;
--
-- ROLLBACK (volver a permitir delete a los roles de oficina, como C2 Fase 1):
-- do $$ declare t text; q text;
--   s text[] := array['prestamos','multas','gastos_variables','gastos_fijos','contratos','abonos'];
--   w text := 'app_rol() = any(array[''superadmin'',''admin'',''operador'',''rrhh'',''directivo'',''demo_admin'',''demo_operador'',''demo_rrhh''])';
-- begin foreach t in array s loop q:=quote_ident(t);
--   execute 'drop policy if exists btg_del_superadmin on public.'||q;
--   execute 'create policy btg_rol_del on public.'||q||' for delete to authenticated using ('||w||')';
-- end loop; end $$;
