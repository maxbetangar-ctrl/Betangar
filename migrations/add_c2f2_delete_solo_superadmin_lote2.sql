-- ════════════════════════════════════════════════════════════════════════════
-- C2 Fase 2 · PASO 3 (lote 2) — DELETE solo superadmin en empleados/gasol/gasoil.
--
-- empleados: ya era superadmin-only en el cliente (eliminarEmpleado) → lo hacemos
--   cumplir también server-side. gasol/gasoil (gasolina personal / surtidas de gasoil):
--   su ÚNICO delete es por token (callback silencioso; el toast de gasoil ya se silenció
--   en el cliente v=…). Ni el chofer ni recibir escriben estas tablas (son de oficina).
--   De paso: gasol hoy lo puede LEER anon → se cierra (authenticated).
--
-- Solo endurece DELETE (→ superadmin). Crear/editar/leer del día a día siguen (combustible
-- se sigue registrando normal). ⚠️ NO toca BNC ni chofer. Reversible (rollback abajo).
-- Correr en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════════════

-- (A) empleados: ya tiene políticas por-comando (C2 Fase 1) → solo cambiamos DELETE.
do $$
begin
  if exists(select 1 from information_schema.tables where table_schema='public' and table_name='empleados' and table_type='BASE TABLE') then
    execute 'alter table public.empleados enable row level security';
    execute 'drop policy if exists btg_rol_del on public.empleados';
    execute 'drop policy if exists btg_del_superadmin on public.empleados';
    execute 'create policy btg_del_superadmin on public.empleados for delete to authenticated using (app_rol() = ''superadmin'')';
  end if;
end $$;

-- (B) gasol / gasoil: reset limpio de políticas (no sabemos los nombres previos → se
--     dropean TODAS por pg_policies y se recrean per-comando).
do $$
declare pol record; t text; q text;
  s text[] := array['gasol','gasoil'];
begin
  foreach t in array s loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      q := quote_ident(t);
      execute 'alter table public.'||q||' enable row level security';
      for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute 'drop policy if exists '||quote_ident(pol.policyname)||' on public.'||q;
      end loop;
      execute 'create policy btg_sel on public.'||q||' for select to authenticated using (true)';
      execute 'create policy btg_ins on public.'||q||' for insert to authenticated with check (true)';
      execute 'create policy btg_upd on public.'||q||' for update to authenticated using (true) with check (true)';
      execute 'create policy btg_del_superadmin on public.'||q||' for delete to authenticated using (app_rol() = ''superadmin'')';
      execute 'revoke all on public.'||q||' from anon';
    end if;
  end loop;
end $$;

-- VERIFICAR: select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and tablename in ('empleados','gasol','gasoil') order by tablename, cmd;
--
-- ROLLBACK (empleados vuelve a delete por roles de oficina; gasol/gasoil a authenticated abierto):
-- do $$ declare t text; q text;
--   w text := 'app_rol() = any(array[''superadmin'',''admin'',''operador'',''rrhh'',''directivo'',''demo_admin'',''demo_operador'',''demo_rrhh''])';
-- begin
--   execute 'drop policy if exists btg_del_superadmin on public.empleados';
--   execute 'create policy btg_rol_del on public.empleados for delete to authenticated using ('||w||')';
--   foreach t in array array['gasol','gasoil'] loop q:=quote_ident(t);
--     execute 'drop policy if exists btg_del_superadmin on public.'||q;
--     execute 'create policy btg_del_all on public.'||q||' for delete to authenticated using (true)';
--   end loop;
-- end $$;
