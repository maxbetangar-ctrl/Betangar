-- ════════════════════════════════════════════════════════════════════════════
-- AUDITORÍA INMUTABLE (append-only) — ISO 27001 A.12.4 (registro y monitoreo forense)
-- La app SOLO inserta en `auditoria` (audit() = insert). Nadie debe poder ALTERAR ni BORRAR
-- el rastro → quitamos UPDATE/DELETE a los roles del cliente. INSERT y SELECT se conservan.
-- Reversible con GRANT. service_role (server, no expuesto al cliente) mantiene control total.
-- Correr en Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════
REVOKE UPDATE, DELETE ON public.auditoria FROM anon, authenticated;

-- Defensa en profundidad opcional (descomenta si quieres bloquear UPDATE/DELETE incluso ante
-- una sesión privilegiada por error; NOTA: también afectaría a service_role / mantenimiento):
-- CREATE OR REPLACE FUNCTION public.auditoria_no_mutar() RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN RAISE EXCEPTION 'auditoria es append-only (inmutable)'; END; $$;
-- DROP TRIGGER IF EXISTS trg_auditoria_immutable ON public.auditoria;
-- CREATE TRIGGER trg_auditoria_immutable BEFORE UPDATE OR DELETE ON public.auditoria
--   FOR EACH ROW EXECUTE FUNCTION public.auditoria_no_mutar();

-- Verificación: estos deben FALLAR con sesión normal (authenticated) y permission denied:
--   UPDATE public.auditoria SET detalle='x';   -- debe dar 42501
--   DELETE FROM public.auditoria;              -- debe dar 42501
