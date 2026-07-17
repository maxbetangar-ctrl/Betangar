-- endurecimiento_funciones_anon_2026-07-16.sql  (base compartida hrkjddehqnzcqwlkklqm: Betangar+Geppetto+Ranita)
-- Espejada en geppetto-app / ranita-app / Betangar (misma base). Aplicar UNA vez.
-- Cierra la clase de hueco "función nace anon-ejecutable" (default de Supabase) + blinda las públicas.
-- Ver causa raíz en maxcrypto-app/migrations/010_endurecimiento_anon.sql y SEGURIDAD_ESTADO.md.

-- (1) Cortar la raíz: ninguna función futura nace anon.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- (2) edu_cambio_cuentas: mueve dinero entre cuentas; la llama SOLO el API route
--     geppetto-app/pages/api/pagos-completo.js con service_role (deriva el tenant server-side,
--     fail-closed, en lib/tenantServer.js). No debe ser ejecutable ni por anon ni por authenticated.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='edu_cambio_cuentas'
  loop
    execute format('revoke execute on function %s from anon, public, authenticated', r.sig);
  end loop;
end $$;

-- (3) CERRAR anon: residuales self-guarded / triggers-helpers no invocados como RPC /
--     funciones llamadas solo por service_role o por sesión autenticada (verificado en los repos).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'edu_busqueda_cedula_check','edu_renovar_token','edu_get_tenant_id','edu_is_staff',
      'edu_tenant_de_auth','edu_mis_alumnos','edu_handle_new_auth_user','edu_on_auth_user_created',
      'edu_protege_saldo_favor','generar_id_interno_alumno','usdt_es_admin','usdt_resumen_visor',
      'usdt_saldo_actual','verificar_txid',
      'audit_sensible','purgar_selfies_asistencia','guardar_tasa_bcv_hoy','edu_get_pin_semanal'
    ])
  loop
    execute format('revoke execute on function %s from anon, public', r.sig);
  end loop;
end $$;

-- (4) MANTENER anon (públicas: fichar/entregas del chofer aseo, formulario de citas, chequeo de licencia):
--     GRANT explícito idempotente → sobrevive al default flip y a un futuro cambio de firma.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'fichar_asistencia','unidad_publica','entrega_confirmar','entrega_registrar','entrega_ver',
      'entregas_del_dia','empleados_publicos','citas_horarios_ocupados','licencia_estado',
      'licencia_por_dominio','wassenger_estado','surtida_registrar'
    ])
  loop
    execute format('grant execute on function %s to anon', r.sig);
  end loop;
end $$;
