-- ═══════════════════════════════════════════════════════════════════════════════
-- EL TERCER ESTADO DE UNA MEDICIÓN: «está mal y NO se pudo arreglar»
--
-- 🎯 POR QUÉ. Hasta hoy una medición solo podía estar en dos estados:
--      · normal     → la auditoría opina, y el consumo de ese día cuenta como bueno
--      · corregida  → alguien pisó la altura; las reglas se callan, pero el consumo
--                     IGUAL se calcula y suma
--    Falta el caso real: **el dato es falso y ya no hay forma de saber el verdadero**.
--
-- 📌 EL CASO QUE LO PIDIÓ (ticket SOP-20260818-MAVO, JAC-B010, 18/08/2026).
--    El chofer reportó él mismo que en la salida del 18 **cargó la medida del cierre
--    del 17 en vez de medir**, y que no recuerda el valor real. Los números:
--      17/08 salida 49 → llegada 43 · 18/08 salida **43** → llegada 38
--    Las dos lecturas del 18 existen y son coherentes entre sí, así que **ninguna
--    validación lo atrapa**: la jornada queda 'completa' y sus ~59 L entran al
--    consumo, al rendimiento de flota y al costo por km como si fueran medidos.
--
-- ⛔ Y LA MARCA QUE HABÍA NO MARCABA NADA. El diagnóstico del 19/08 se escribió en
--    `notas`: «DUDOSA (19/08): el chofer reporto que cargo la medida del cierre
--    anterior…». **Ese campo no lo lee ningún cálculo.** Un dato marcado en texto
--    libre está marcado para el que abra la fila, para nadie más.
--
-- Aditivo y con default: nada que ya funcione cambia solo.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.combustible_mediciones
  add column if not exists no_confiable        boolean not null default false,
  add column if not exists no_confiable_motivo text,
  add column if not exists no_confiable_por    text,
  add column if not exists no_confiable_at     timestamptz;

comment on column public.combustible_mediciones.no_confiable is
  'El dato es falso y NO se pudo averiguar el verdadero. Distinto de `corregida`: ahí hay un valor bueno; acá no lo hay. La jornada deja de tener consumo medible.';
comment on column public.combustible_mediciones.no_confiable_por is
  'QUIÉN lo declaró. El estado lo declara una persona, no lo deduce el sistema.';

-- Se busca por la marca cuando se arma el resumen del período: son pocas, pero se
-- consultan en cada corrida de la auditoría.
create index if not exists ix_comb_med_no_confiable
  on public.combustible_mediciones (vehiculo_id, fecha)
  where no_confiable;
