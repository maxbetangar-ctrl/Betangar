-- ════════════════════════════════════════════════════════════════════════════
-- CERRAR EL FAIL-OPEN DE RLS  (aplicado 2026-07-20 en Flotilla y Betangar)
--
-- HALLAZGO: 18 tablas sensibles tenían la lectura escrita así:
--     using ( (app_rol() IS NULL) OR (app_rol() = ANY (ARRAY['admin', ...])) )
--                ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ fail-open
-- `app_rol()` lee el rol de `btg_usuarios` por auth.uid(). Si el usuario NO tiene
-- ficha ahí, devuelve NULL — y esa primera rama le daba acceso A TODO.
--
-- Y sí había usuarios así: los 19 LOGINS POR UNIDAD (u.fc01, u.fl04, …), que son
-- los que usan los choferes en el teléfono. Ninguno tiene ficha en btg_usuarios.
-- O sea: desde el celular de un chofer se podía leer la nómina completa, los
-- empleados, los préstamos, las multas, los proveedores y los movimientos del
-- banco. Dos de esos logins ya habían entrado.
--
-- Tablas afectadas: abonos, anomalias_rrhh, bnc_movimientos, bnc_notificaciones,
-- caja_chica, caja_chica_reposiciones, contratos, cxp, empleados, gastos_fijos,
-- gastos_variables, multas, nomina_historial, pagos_alcaldia, pagos_bnc,
-- pagos_nomina, prestamos, proveedores.
--
-- POR QUÉ ERA SEGURO CERRARLO: se revisó qué consulta la app del chofer
-- (chofer.html, fichar.html): asistencia, checklist, combustible_mediciones,
-- destinos, entregas, flota_estado, km_data, porteria, sitios_asistencia y
-- viajes_chofer. NINGUNA de las 18. Y las 10 que sí usa están abiertas a
-- cualquier usuario autenticado, así que no dependían del fail-open.
--
-- VERIFICADO DESPUÉS, poniéndose en la sesión del login real u.fc01:
--     nomina_historial 0 · empleados 0 · prestamos 0 · viajes_chofer 186
-- El chofer sigue trabajando; la nómina quedó cerrada.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare r record; lista text;
begin
  for r in
    select tablename, policyname, qual from pg_policies
    where schemaname='public' and qual like '%app_rol() IS NULL%'
  loop
    -- Se conserva la MISMA lista de roles; solo se elimina la rama del NULL.
    lista := (regexp_match(r.qual, '(ARRAY\[[^\]]*\])'))[1];
    if lista is null then
      raise notice 'SALTADA (no tiene lista de roles): %.%', r.tablename, r.policyname;
      continue;
    end if;
    execute format('alter policy %I on public.%I using (app_rol() = ANY (%s))',
                   r.policyname, r.tablename, lista);
    raise notice 'cerrada: %.%', r.tablename, r.policyname;
  end loop;
end $$;

-- Verificación: debe dar 0.
-- select count(*) from pg_policies where schemaname='public' and qual like '%app_rol() IS NULL%';

-- ── PENDIENTE (decisión de Máximo) ──────────────────────────────────────────
-- Los 19 logins por unidad siguen sin ficha en `btg_usuarios`, o sea sin rol.
-- Hoy eso ya no les da acceso de más, pero lo correcto es darles un rol propio
-- (ej. 'unidad') para que el permiso sea explícito y no un vacío.
