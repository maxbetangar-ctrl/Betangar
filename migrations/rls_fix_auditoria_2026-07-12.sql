-- ============================================================================
-- FIX SEGURIDAD Betangar — auditoría 2026-07-11 (aplicado 2026-07-12)
-- Proyecto Supabase hrkjddehqnzcqwlkklqm (compartido con Geppetto: NO se tocó ninguna edu_*/usdt_*).
-- Todo es RLS/funciones (no cambia app.js/html → no requiere redeploy). Idempotente.
-- ============================================================================

-- #1 CRÍTICO: escalada vía aplicar_accion_aprobada (RPC DEFINER, corría como postgres, granted a
--    authenticated, 0 usos en la app) + tokens_pendientes abierto a anon Y authenticated (USING true).
--    Un operativo/visualizador podía insertar token, auto-aprobarlo y ejecutar borrados/updates de dinero.
do $$ declare r record; begin
  for r in select oid::regprocedure as sig from pg_proc where proname='aplicar_accion_aprobada' loop
    execute format('revoke execute on function %s from anon, authenticated, public', r.sig);
  end loop;
end $$;
drop policy if exists betangar_access on public.tokens_pendientes;
drop policy if exists btg_auth_all on public.tokens_pendientes;
create policy tok_sel on public.tokens_pendientes for select to authenticated using (true);
create policy tok_ins on public.tokens_pendientes for insert to authenticated with check (true);
create policy tok_upd_superadmin on public.tokens_pendientes for update to authenticated using (public.app_rol()='superadmin') with check (public.app_rol()='superadmin');
create policy tok_del_superadmin on public.tokens_pendientes for delete to authenticated using (public.app_rol()='superadmin');
-- (#3 MEDIO "auto-aprobación" queda resuelto por lo anterior: aprobar = solo superadmin.)

-- #2 ALTO: planillas (verdad del dinero: nómina + alcaldía) escribible/borrable por cualquiera (anon+auth).
drop policy if exists betangar_access on public.planillas;
drop policy if exists btg_auth_all on public.planillas;
create policy plan_sel on public.planillas for select to authenticated using (true);
create policy plan_ins on public.planillas for insert to authenticated
  with check (public.app_rol() = any(array['superadmin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));
create policy plan_upd on public.planillas for update to authenticated
  using (public.app_rol() = any(array['superadmin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
  with check (public.app_rol() = any(array['superadmin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));
create policy plan_del_superadmin on public.planillas for delete to authenticated using (public.app_rol()='superadmin');

-- #5 MEDIO: gasoil/gasol (alimentan la Utilidad Real) escribibles por cualquier autenticado.
do $$ declare tbl text; begin
  foreach tbl in array array['gasoil','gasol'] loop
    execute format('drop policy if exists btg_ins on public.%I', tbl);
    execute format('drop policy if exists btg_upd on public.%I', tbl);
    execute format($f$create policy btg_ins on public.%I for insert to authenticated with check (public.app_rol() = any(array['superadmin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))$f$, tbl);
    execute format($f$create policy btg_upd on public.%I for update to authenticated using (public.app_rol() = any(array['superadmin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh'])) with check (public.app_rol() = any(array['superadmin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))$f$, tbl);
  end loop;
end $$;

-- #4 MEDIO: entrega_registrar (RPC anon) permitía pisar entregas CONFIRMADAS por id adivinable.
--    Ahora solo actualiza si NO está confirmada y el token coincide. (Función recreada — ver
--    add_entregas_rpc.sql con la cláusula WHERE al final del on-conflict.)
-- (aplicada por separado; ver el repo/historial 2026-07-12).

-- Verificación: como anon → insert en tokens_pendientes/planillas = 401; RPC aplicar_accion_aprobada
-- no ejecutable por authenticated; con rol operativo/visualizador → PATCH planillas/gasoil = 403;
-- con superadmin/oficina → sigue funcionando.
