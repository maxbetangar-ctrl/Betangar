-- ════════════════════════════════════════════════════════════════════════════
-- C2 Fase 2 (pieza 1) + M3 (auditoría Fable 5, 2026-07-04) — AUDITORÍA SERVER-SIDE de
-- las mutaciones sensibles. Un trigger AFTER UPDATE/DELETE en las tablas de dinero registra
-- en `auditoria` QUIÉN (usuario real desde btg_usuarios por auth.uid()), QUÉ (tabla+operación)
-- y la fila afectada — INCLUSO si la mutación se hizo por API directa saltándose el token de la
-- UI. Cierra el hueco de M3: antes audit() solo corría desde la app, y una escritura directa por
-- PostgREST no dejaba rastro. Ahora toda edición/borrado de dinero queda con traza forense.
--
-- SEGURO: (1) NO bloquea NUNCA la operación (si el log falla, se traga el error y la escritura
-- sigue). (2) Solo AGREGA registros (la tabla auditoria es append-only, ya protegida). (3) Solo
-- UPDATE/DELETE (las operaciones que modifican/borran dinero; los INSERT crean registros visibles).
-- (4) created_at de auditoria da la hora REAL del servidor (no la del cliente).
-- Reusa auth.uid() (funciona dentro de SECURITY DEFINER: lee el claim del JWT del request).
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm). Reversible (DROP al final).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.audit_sensible() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_usuario text;
  v_det text;
begin
  begin
    select coalesce(usuario, email, auth_user_id::text) into v_usuario
      from btg_usuarios where auth_user_id = auth.uid() limit 1;
    if v_usuario is null then v_usuario := coalesce(auth.uid()::text,'(sin sesion)'); end if;
    v_det := left((case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end)::text, 400);
    -- Columnas REALES de auditoria: operador, accion, detalle, created_at (auto). NO {fecha, usuario}.
    insert into auditoria(operador, accion, detalle)
      values(v_usuario, 'DB '||TG_TABLE_NAME||' '||TG_OP, v_det);
  exception when others then
    null; -- el log JAMÁS bloquea la operación real
  end;
  return null;
end $$;

do $$
declare
  t text; q text;
  s text[] := array[
    'abonos','anomalias_rrhh','bnc_notificaciones','bnc_movimientos','caja_chica',
    'caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables','gastos_fijos',
    'multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'
  ];
begin
  foreach t in array s loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      q := quote_ident(t);
      execute 'drop trigger if exists trg_audit_sensible on public.'||q;
      execute 'create trigger trg_audit_sensible after update or delete on public.'||q||' for each row execute function public.audit_sensible()';
    end if;
  end loop;
end $$;

-- VERIFICAR: select event_object_table, trigger_name from information_schema.triggers
--   where trigger_name='trg_audit_sensible' order by event_object_table;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (quitar los triggers): descomentar y correr.
-- do $$
-- declare t text; q text;
--   s text[] := array['abonos','anomalias_rrhh','bnc_notificaciones','bnc_movimientos','caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables','gastos_fijos','multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'];
-- begin
--   foreach t in array s loop
--     if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
--       q := quote_ident(t);
--       execute 'drop trigger if exists trg_audit_sensible on public.'||q;
--     end if;
--   end loop;
-- end $$;
-- drop function if exists public.audit_sensible();
-- ════════════════════════════════════════════════════════════════════════════
