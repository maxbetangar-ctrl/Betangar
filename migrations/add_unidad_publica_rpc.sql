-- ════════════════════════════════════════════════════════════════════════════
-- RPC unidad_publica (FlotaMax, paso 2a): la app del chofer (key anon) necesita
-- resolver una unidad NUEVA (no JAC) desde unidad_config, que está CERRADA a anon.
-- Este RPC SECURITY DEFINER devuelve SOLO los datos mínimos de UNA unidad, por su
-- cam (el del QR). No expone el registro completo: hay que saber el cam exacto y
-- solo salen 5 campos no sensibles. Las unidades inactivas no se devuelven.
-- Idempotente. Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.unidad_publica(p_cam text)
returns table(cam text, chofer text, placa text, nombre text, activo boolean)
language sql security definer set search_path = public stable as $$
  select cam, chofer, placa, nombre, activo
  from unidad_config
  where cam = upper(trim(p_cam)) and activo is not false
  limit 1;
$$;

grant execute on function public.unidad_publica(text) to anon, authenticated;

-- VERIFICAR (opcional): debe devolver la fila si existe una unidad con ese cam.
--   select * from public.unidad_publica('B001');
