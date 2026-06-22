-- FIX tras migrar el login a Supabase Auth: las tablas de Betangar tenían políticas RLS
-- solo para 'anon'. Ahora los usuarios entran como 'authenticated' → veían 0 filas.
-- Esto añade a CADA tabla de Betangar una política permisiva para authenticated (igual que
-- anon: Betangar es mono-empresa, todo el staff ve todo). NO toca las tablas edu_* (Geppetto).
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'abonos','anomalias_rrhh','auditoria','bnc_config_estado','bnc_notificaciones',
    'caja_chica','caja_chica_reposiciones','checklist','combustible_alertas',
    'combustible_mediciones','combustible_tanques_config','combustible_vehiculos_config',
    'configuracion','contratos','cxp','empleados','engrases','flota_estado','gasoil',
    'gastos_variables','health_check','inventario','km_data','lavados','mantenimientos',
    'mensajes_wa','multas','pagos_alcaldia','pagos_bnc','pagos_nomina','planillas',
    'porteria','prestamos','proveedores','rutas_estado','viajes_chofer'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t AND table_type='BASE TABLE') THEN
      EXECUTE format('DROP POLICY IF EXISTS btg_auth_all ON public.%I', t);
      EXECUTE format('CREATE POLICY btg_auth_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;
