-- ════════════════════════════════════════════════════════════════════════════
-- Retenciones configurables POR CONTRATO (vender/clonar a empresas con otra facturación)
-- Correr en Supabase (SQL Editor). Aditiva y reversible. NO toca datos existentes.
--   contratos.retenciones : perfil de retención del contrato (JSON con tasas en decimal,
--                           ej. {"iva":0.16,"retIVA":0.75,"retISLR":0.02,"retMun":0.01,
--                           "timbre":0.001,"fiel":0.10,"laboral":0,"respSocial":0.03}).
--                           NULL = usa el perfil por defecto (Alcaldía) en la app.
--   abonos.contrato       : id del contrato bajo el que se registró ese pago (para que la
--                           conciliación use sus retenciones). NULL = Alcaldía por defecto.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS retenciones jsonb;
ALTER TABLE public.abonos    ADD COLUMN IF NOT EXISTS contrato    text;

-- Verificación rápida:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('contratos','abonos') AND column_name IN ('retenciones','contrato');
