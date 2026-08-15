-- ════════════════════════════════════════════════════════════════════════════════════════════
--  RÉPLICA A BETANGAR de la migración homónima de `flotilla-app` (15/08/2026).
--  Se comprobó ANTES de copiar que las 4 tablas del chofer son IDÉNTICAS en las dos bases:
--  102 columnas cada una, cero diferencias, y los 4 índices únicos con el mismo nombre.
--  Por eso va sin adaptar. El texto original sigue abajo tal cual.
--  ⚠️ Esta base la comparte GEPPETTO (tablas edu_* / usdt_*): nada de esto las toca.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  LA MEDICIÓN EN CENTÍMETROS VALE AUNQUE NO SE SEPAN LOS LITROS
--  15/08/2026
--
--  QUÉ PASABA
--  `combustible_mediciones.litros_calculados` era NOT NULL y sin valor por defecto. Pero los
--  litros no se miden: se CALCULAN a partir de la altura en cm y la cubicación del tanque de esa
--  unidad. Si la unidad no está cubicada, no hay litros — y el cliente manda `null`, tal como dice
--  su propio comentario: «null si esta unidad no tiene su tanque medido».
--
--  Resultado: el insert se rechazaba con 23502 y **la medición se perdía**. Y se perdía EN
--  SILENCIO, porque `clGuardarMedicionCm` solo hace `console.error` — el chofer mide el tanque,
--  toca guardar, la app no dice nada y no queda nada.
--
--  ⛔ CUÁNTO PESA, MEDIDO EL 15/08/2026 EN FLOTILLA:
--       20 unidades en operación
--        8 con cubicación configurada
--     → **12 unidades (el 60% de la flota) no podían registrar la medición de su tanque.**
--
--  Apareció ejerciendo la RPC nueva `chofer_medicion_guardar` con una unidad sin cubicación: la
--  función falló con el mismo 23502 que ya fallaba el camino viejo. La RPC no lo causó, lo destapó.
--
--  POR QUÉ NULO Y NO CERO
--  Cero litros es un dato: el tanque está vacío. Nulo es otro: no sabemos cuántos litros son esos
--  40 cm porque nadie cubicó este tanque. Escribir 0 haría que el consumo de esas 12 unidades se
--  calcule contra un tanque que la app cree vacío — un número que el dueño no puede explicar.
--  La altura en cm queda guardada igual, que es lo que el chofer sí midió; los litros se pueden
--  completar el día que se cubique la unidad.
--
--  Es idempotente y NO toca ninguna fila existente: relajar un NOT NULL no invalida lo ya escrito.
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

alter table public.combustible_mediciones
  alter column litros_calculados drop not null;

comment on column public.combustible_mediciones.litros_calculados is
  'Litros derivados de altura_cm por la cubicación del tanque de la unidad. NULL LEGÍTIMO = la unidad no está cubicada, así que los litros son desconocidos. NO es lo mismo que 0 (tanque vacío). La medida real que tomó el chofer es altura_cm.';

commit;

-- ── COMPROBACIÓN (correr y MIRAR) ───────────────────────────────────────────────────────────
-- La primera fila tiene que decir YES. La segunda es el control: si `altura_cm` no sale, la
-- consulta no está mirando lo que creés y el resultado de la primera no significa nada.
--
-- select column_name, is_nullable from information_schema.columns
--  where table_name='combustible_mediciones' and column_name in ('litros_calculados','altura_cm');

-- ── REVERSA ─────────────────────────────────────────────────────────────────────────────────
-- ⚠️ Solo se puede volver atrás si NO quedó ninguna fila con litros nulos. Si las 12 unidades sin
--    cubicar ya registraron mediciones, volver al NOT NULL exige decidir qué hacer con ellas —y
--    ponerles 0 sería inventar que sus tanques estaban vacíos.
-- begin;
--   alter table public.combustible_mediciones
--     alter column litros_calculados set not null;
-- commit;
