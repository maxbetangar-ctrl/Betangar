-- ════════════════════════════════════════════════════════════════════════════
-- CAPACIDAD DEL TANQUE POR UNIDAD  (2026-07-25)
--
-- POR QUÉ: los carros pequeños NO se pueden cubicar — el tanque es de plástico moldeado,
-- metido bajo el asiento, con la forma que le deje el chasis, y no se le puede meter la
-- regla (el tubo de llenado va curvo y con válvula). Forzar una fórmula ahí sería inventar
-- litros, que es justo el error que destapó la tabla del JAC (600 ÷ 46 parecía un dato).
-- De un carro chico solo hace falta UN número, y sale de la ficha del fabricante:
-- cuántos litros le caben. Con eso el consumo se mide DE CARGA A CARGA (llenar a tope y
-- cruzar litros contra km), que además es más exacto que cualquier cubicación.
--
-- QUÉ SE GANA YA: el tope de una surtida deja de ser un número general y pasa a ser el de
-- CADA unidad. Una pickup de 76 L no puede cargar 251 L. Margen del 50% para no trancar la
-- operación por bidones o tanque auxiliar; el margen fino lo pone la auditoría, no el freno.
--
-- capacidad_origen NUNCA miente sobre de dónde salió el número:
--   medido = alguien lo midió · ficha = especificación del fabricante · estimado = deducido.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.unidad_config add column if not exists capacidad_tanque_l numeric;
alter table public.unidad_config add column if not exists capacidad_origen text;
alter table public.unidad_config add column if not exists capacidad_fuente text;

-- Los 12 JAC de Betangar: el tanque se MIDIÓ con cinta el 2026-07-25 (60 x 52,5 x 199,
-- esquinas redondeadas r=12,54) y da 600 L, que es EXACTAMENTE lo que dice la ficha del
-- HFC1131KR1. Tres medidas independientes reproduciendo la capacidad de fábrica.
update public.unidad_config set
  capacidad_tanque_l = 600, capacidad_origen = 'medido',
  capacidad_fuente = 'Medido con cinta 2026-07-25 (60x52,5x199, r=12,54) = 600 L. La ficha JAC HFC1131KR1 dice 600 L: coinciden.'
where modelo like '%1131%' and capacidad_tanque_l is null;

-- Y surtida_registrar toma el tope de ahí: least(tope general, capacidad x 1,5).
-- Verificado: JAC-B001 (600 L) rechaza 1.500 L y acepta 400 L.
