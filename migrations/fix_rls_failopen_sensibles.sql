-- ════════════════════════════════════════════════════════════════════════════
-- FIX RLS FAIL-OPEN en tablas SENSIBLES (auditoría 2026-07-06, alto Betangar).
-- Problema real (verificado en vivo 2026-07-09):
--   • El SELECT (btg_rol_lectura) era FAIL-OPEN: `(app_rol() IS NULL OR app_rol()=any(oficina))`
--     → cualquier autenticado SIN rol Betangar (usuarios de GEPPETTO/RANITA, cuentas de unidad/chofer
--     sin fila en btg_usuarios) podía LEER nómina, empleados, pagos, préstamos, etc.
--     (probado: la maestra Geppetto veía 17 filas de nomina_historial y 75 empleados).
--   • Además había políticas ABIERTAS `USING(true)` a public/authenticated (nh_all, pagos_bnc_auth,
--     pagos_nomina_auth, bnc_mov_auth, allow_all_gastos_var, allow_all_pagos_alcaldia) y a anon
--     (betangar_access, allow_all) que saltaban por completo el control por rol.
-- Fix:
--   A) DROP de todas esas políticas abiertas en las tablas sensibles.
--   B) btg_rol_lectura (SELECT) pasa a FAIL-CLOSED: solo roles de oficina; sin rol → DENEGADO.
-- NO se tocan INSERT/UPDATE/DELETE (ya eran fail-closed) ni las tablas OPERATIVAS (porteria,
--   checklist, viajes_chofer, km_data, entregas, flota_estado, combustible_*) → el chofer sigue igual.
-- Seguro: los 15 usuarios de btg_usuarios (oficina) tienen rol válido + auth_user_id → no se rompen.
-- Reversible: ver ROLLBACK al final. Correr en Supabase (o Management API).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  w text;
  sens text[] := array[
    'abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos',
    'caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables',
    'multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'
  ];
  -- Políticas ABIERTAS (anon/public/authenticated con USING true) que hay que eliminar.
  abiertas text[] := array[
    'betangar_access','allow_all','allow_all_gastos_var','allow_all_pagos_alcaldia',
    'nh_all','pagos_bnc_auth','pagos_nomina_auth','bnc_mov_auth'
  ];
  cond_read text := $c$ (app_rol() = any(array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh'])) $c$;
begin
  foreach t in array sens loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      -- A) quitar políticas abiertas que saltan el control por rol
      foreach w in array abiertas loop
        execute format('drop policy if exists %I on public.%I', w, t);
      end loop;
      -- B) SELECT fail-CLOSED (quita el "app_rol() is null" que dejaba entrar a los sin rol)
      if exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='btg_rol_lectura') then
        execute format('drop policy btg_rol_lectura on public.%I', t);
        execute format('create policy btg_rol_lectura on public.%I for select to authenticated using (%s)', t, cond_read);
      end if;
    end if;
  end loop;
end $$;

-- VERIFICACIÓN (correr aparte):
--   Ninguna política abierta debe quedar en estas tablas:
--   select tablename, policyname, roles, qual from pg_policies
--     where schemaname='public' and tablename = any(array['empleados','nomina_historial','pagos_bnc','pagos_nomina','bnc_movimientos','gastos_variables','pagos_alcaldia'])
--       and qual='true' order by tablename;   -- => 0 filas

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si algo se rompe): re-abre SELECT (fail-open) y restaura las políticas amplias.
-- do $$
-- declare t text;
--   sens text[] := array['abonos','anomalias_rrhh','bnc_config_estado','bnc_notificaciones','bnc_movimientos','caja_chica','caja_chica_reposiciones','contratos','cxp','empleados','gastos_variables','multas','nomina_historial','pagos_alcaldia','pagos_bnc','pagos_nomina','prestamos','proveedores'];
--   cond_open text := $c$ (app_rol() is null or app_rol()=any(array['superadmin','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh'])) $c$;
-- begin
--   foreach t in array sens loop
--     if exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='btg_rol_lectura') then
--       execute format('drop policy btg_rol_lectura on public.%I', t);
--       execute format('create policy btg_rol_lectura on public.%I for select to authenticated using (%s)', t, cond_open);
--     end if;
--   end loop;
--   -- (las políticas abiertas nh_all/pagos_bnc_auth/etc. NO se recrean: eran el hueco. Si de verdad
--   --  hiciera falta abrir una tabla, hacerlo puntual y con criterio, no con USING(true) global.)
-- end $$;
-- ════════════════════════════════════════════════════════════════════════════
