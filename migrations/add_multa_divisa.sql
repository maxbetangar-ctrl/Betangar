-- ════════════════════════════════════════════════════════════════════════════
-- MULTAS EN DIVISA (USD/EUR) — la deuda vive en divisa y se CONGELA en Bs SOLO al pagar.
-- Modelo (decisión de Máximo 2026-06-29): la multa se registra en dólar (tasa BCV $) o euro
-- (tasa BCV €); mientras no se paga es una cuenta por pagar en esa divisa (no en Bs). Al pagar
-- cada cuota se convierte a Bs a la TASA DEL DÍA DEL PAGO y ese Bs queda CONGELADO en `pagado_bs`.
-- Las multas viejas (solo monto_bs, sin `moneda`) siguen funcionando igual (legacy Bs).
-- Aditiva y segura: no toca datos existentes. Correr en Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.multas add column if not exists moneda     text;     -- 'USD' | 'EUR' (null = legacy Bs)
alter table public.multas add column if not exists monto_div  numeric;  -- monto total en la divisa
alter table public.multas add column if not exists cuota_div  numeric;  -- cuota (semanal) en la divisa
alter table public.multas add column if not exists pagado_div numeric default 0; -- divisa ya descontada (progreso)

-- `pagado_bs` (ya existente) acumula el Bs REAL pagado, congelado a la tasa de cada pago.
comment on column public.multas.moneda     is 'USD/EUR de la deuda; null = multa vieja en Bs (monto_bs)';
comment on column public.multas.monto_div  is 'Monto total de la multa en su divisa (USD/EUR)';
comment on column public.multas.cuota_div  is 'Cuota semanal en divisa; al pagar se congela a Bs en pagado_bs';
comment on column public.multas.pagado_div is 'Acumulado de divisa ya descontado en nómina';
