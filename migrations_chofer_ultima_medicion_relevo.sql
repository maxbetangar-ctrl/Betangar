-- ═══════════════════════════════════════════════════════════════════════════════
-- ACTA DE RELEVO ASISTIDA — CONSULTA DE ÚLTIMA MEDICIÓN DE ENTREGA (LLEGADA)
--
-- Devuelve la última medición de llegada registrada de la unidad con su altura en cm,
-- litros calculados, fecha y quién la registró, para que el chofer entrante pueda
-- contrastar su medición de regla al abrir turno sin precargarla engañosamente.
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.chofer_ultima_medicion(p_cam text)
returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'altura_cm', altura_cm,
    'litros_calculados', litros_calculados,
    'fecha', fecha,
    'momento', momento,
    'registrado_por', registrado_por,
    'created_at', created_at
  )
  from public.combustible_mediciones
  where vehiculo_id = p_cam and momento = 'llegada' and altura_cm is not null
    and public.chofer_puede_ver(p_cam)
  order by fecha desc, id desc
  limit 1;
$$;

revoke all on function public.chofer_ultima_medicion(text) from public;
grant execute on function public.chofer_ultima_medicion(text) to anon, authenticated, service_role;
