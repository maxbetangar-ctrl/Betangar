-- ════════════════════════════════════════════════════════════════════════════
-- FIX C2 (auditoría Fable 5, 2026-07-04) — cerrar dos huecos de la RLS por rol SIN
-- trancar a la oficina. Reemplaza la política única `btg_rol_oficina` (FOR ALL, que dejaba
-- ESCRIBIR a TODO rol de oficina, incluido `visualizador`, y fail-open en null) por políticas
-- POR COMANDO en las 18 tablas sensibles:
--   • LECTURA (SELECT): todos los roles de oficina + rol desconocido (fail-open) → nadie pierde vista.
--   • ESCRITURA (INSERT/UPDATE/DELETE): SOLO roles que legítimamente escriben a diario
--     (superadmin/admin/operador/rrhh/directivo + demos). NO `visualizador`. NO null (sin fail-open).
--
-- Qué cierra:
--   1) `visualizador` ya NO puede escribir/borrar dinero por PostgREST (era de-solo-ver pero podía escribir).
--   2) Una cuenta autenticada SIN fila en btg_usuarios (rol null) ya NO puede escribir dinero (sí leer).
-- Qué NO cambia (a propósito, para no romper la operación):
--   • admin/operador/rrhh/directivo siguen creando/editando/borrando a diario (registrar pagos, marcar
--     CxP pagada, borrar semana de nómina, borrar empleado duplicado, confirmar pago BNC, etc.).
--   • Los roles OPERATIVOS (vigilante/mecanico/asistencia/operativo) siguen DENEGADOS por completo
--     (no están en ninguna lista) — igual que antes.
-- Lo que queda para una FASE 2 (no aquí): que admin/operador/rrhh tampoco puedan saltarse el token
--   de aprobación por API directa → requiere rutear las mutaciones de dinero por RPCs SECURITY DEFINER
--   que verifiquen tokens_pendientes.aprobado. Es un refactor de código, no solo RLS.
--
-- Reversible: bloque ROLLBACK al final (recrea btg_rol_oficina abierta).
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).
-- Reusa la función app_rol() ya existente (de add_rls_por_rol.sql): lee el rol de btg_usuarios,
-- NO del JWT (que el usuario podría falsear).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  sensibles text[] := array[
    'abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos',
    'caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables',
    'multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'
  ];
  -- LECTURA: oficina completa + demos + fail-open null (nadie pierde vista).
  lee text := $c$ (app_rol() is null or app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh'])) $c$;
  -- ESCRITURA: SOLO quien escribe a diario. Sin visualizador. Sin null (sin fail-open en writes).
  esc text := $c$ (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh'])) $c$;
begin
  foreach t in array sensibles loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      -- Quitar la política vieja (FOR ALL) y cualquier residuo.
      execute format('drop policy if exists btg_auth_all on public.%I', t);
      execute format('drop policy if exists btg_rol_oficina on public.%I', t);
      execute format('drop policy if exists btg_rol_lectura on public.%I', t);
      execute format('drop policy if exists btg_rol_escritura on public.%I', t);
      -- Política de LECTURA (permisiva, se combina con OR con la de escritura para SELECT).
      execute format('create policy btg_rol_lectura on public.%I for select to authenticated using (%s)', t, lee);
      -- Políticas de ESCRITURA por comando.
      execute format('create policy btg_rol_ins on public.%I for insert to authenticated with check (%s)', t, esc);
      execute format('create policy btg_rol_upd on public.%I for update to authenticated using (%s) with check (%s)', t, esc, esc);
      execute format('create policy btg_rol_del on public.%I for delete to authenticated using (%s)', t, esc);
    end if;
  end loop;
end $$;

-- VERIFICACIÓN (correr aparte):
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and policyname like 'btg_rol_%' order by tablename, cmd;
--   -- Debe listar por tabla: btg_rol_lectura (SELECT), btg_rol_ins (INSERT), btg_rol_upd (UPDATE), btg_rol_del (DELETE).

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si algo se rompe, volver a la política única abierta): descomentar y correr.
-- do $$
-- declare t text;
--   sensibles text[] := array['abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos','caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables','multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'];
--   cond text := $c$ (app_rol() is null or app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh'])) $c$;
-- begin
--   foreach t in array sensibles loop
--     if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
--       execute format('drop policy if exists btg_rol_lectura on public.%I', t);
--       execute format('drop policy if exists btg_rol_ins on public.%I', t);
--       execute format('drop policy if exists btg_rol_upd on public.%I', t);
--       execute format('drop policy if exists btg_rol_del on public.%I', t);
--       execute format('create policy btg_rol_oficina on public.%I for all to authenticated using (%s) with check (%s)', t, cond, cond);
--     end if;
--   end loop;
-- end $$;
-- ════════════════════════════════════════════════════════════════════════════
