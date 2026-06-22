-- FASE 2c — candado real (ISO 27001: confidencialidad + integridad).
-- Quita el acceso de ANON a las tablas SENSIBLES de oficina (Grupo A): la anon key pública
-- (visible en el HTML) deja de poder LEER/ESCRIBIR/BORRAR nómina, empleados, pagos, etc.
-- 'authenticated' conserva su acceso (grants propios + policy btg_auth_all de la migración 2a),
-- así que la app (usuarios logueados por Supabase Auth) sigue funcionando igual.
--
-- NO se tocan las 6 tablas del CHOFER (Grupo B: checklist, combustible_mediciones, flota_estado,
-- km_data, porteria, viajes_chofer) porque chofer.html NO tiene login (usa anon). Son de baja
-- sensibilidad ("solo vistazo en vivo"; la verdad operativa vive en planillas).
--
-- REVERSIBLE: para deshacer, GRANT SELECT,INSERT,UPDATE,DELETE ON public.<tabla> TO anon;
DO $$
DECLARE
  t text;
  sensibles text[] := ARRAY[
    'abonos','anomalias_rrhh','auditoria','caja_chica','caja_chica_reposiciones',
    'combustible_alertas','combustible_tanques_config','combustible_vehiculos_config',
    'configuracion','contratos','cxp','empleados','engrases','gasoil','gastos_variables',
    'health_check','inventario','lavados','mantenimientos','mensajes_wa','multas',
    'pagos_alcaldia','planillas','prestamos','proveedores','rutas_estado'
  ];
BEGIN
  FOREACH t IN ARRAY sensibles LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t AND table_type='BASE TABLE') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
