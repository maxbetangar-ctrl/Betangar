-- ════════════════════════════════════════════════════════════════════════════════════════════
--  RESCATE: DEVOLVER LA SALIDA QUE BORRÓ EL UPSERT DEL CHECKLIST
--  15/08/2026 · 17:5x
--
--  QUÉ PASÓ (y el daño lo hice yo, no un chofer)
--  Entre las ~16:40 y las ~17:40 de hoy, `chofer.html` de Betangar guardó el checklist con la RPC
--  nueva `chofer_checklist_guardar`. Esa función hacía un upsert que escribía LAS 59 COLUMNAS: las
--  que el cliente no mandaba entraban como NULL. La pantalla de LLEGADA no manda `km_salida` ni
--  `hora_salida` —ésas se llenaron a las 5 de la mañana—, así que **cada camión que registró su
--  llegada en esa hora perdió su salida**.
--
--  Alcanzó a DOS unidades: JAC-B003 (llegada 17:05) y JAC-B012 (llegada 17:26).
--  FLOTILLA no se tocó: su flota había terminado y ninguna llegada pasó por el código nuevo.
--  El defecto quedó arreglado en `checklist_upsert_no_pisa_lo_que_no_vino_2026-08-15.sql`.
--
--  ⛔ DE DÓNDE SALE CADA NÚMERO — no es lo mismo recuperar que inventar
--
--  JAC-B003 · EXACTO. La tabla `auditoria` guarda el estado de la fila en cada UPDATE, y las
--    entradas de las 17:04 y 17:05 —anteriores al borrado— dicen textualmente
--    km_salida 14259, hora_salida 05:45, comb_salida 1/4. Se restaura tal cual.
--
--  JAC-B012 · RECONSTRUIDO, y solo el km. Su fila nació de un INSERT y el trigger de auditoría
--    solo registra UPDATE, así que no hay foto previa del checklist. Pero `km_data` sí quedó
--    auditado: a las 06:25 el chofer lo dejó en 12.801 y a las 17:26 pasó a 12.931 (su llegada).
--    A las 06:25 lo único cargado era la salida, así que ese 12.801 ES el km que tecleó al salir
--    — el mismo dato, guardado en otra tabla.
--    ⚠️ Su `hora_salida` y su `comb_salida` NO se recuperan y NO se inventan. La fila creada a
--       las 06:25 (hora de Venezuela) dice cuándo se guardó, pero no qué hora escribió el chofer.
--       Quedan en NULL: un hueco que se ve es mejor que un número que nadie puede explicar.
--
--  Se escribe con la unidad y la fecha en el WHERE, valor por valor. Ningún patrón, ningún LIKE.
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

-- ── JAC-B003 · del registro de auditoría, exacto ─────────────────────────────────────────────
update public.checklist
   set km_salida   = 14259,
       hora_salida = '05:45',
       comb_salida = '1/4'
 where cam = 'JAC-B003' and fecha = '2026-08-15'
   and km_salida is null;          -- si alguien ya lo corrigió a mano, no se pisa

-- ── JAC-B012 · el km reconstruido desde km_data; la hora y el combustible NO ─────────────────
update public.checklist
   set km_salida = 12801
 where cam = 'JAC-B012' and fecha = '2026-08-15'
   and km_salida is null;

commit;

-- ── COMPROBACIÓN ────────────────────────────────────────────────────────────────────────────
-- Las dos tienen que tener km_salida y km_entrada, y el km del día tiene que dar positivo.
--
-- select cam, km_salida, km_entrada, (km_entrada - km_salida) km_del_dia,
--        coalesce(hora_salida,'(sin recuperar)') hora_salida
--   from public.checklist
--  where fecha='2026-08-15' and cam in ('JAC-B003','JAC-B012');
--
-- Esperado: B003 → 14259 / 14364 / 105 km · 05:45
--           B012 → 12801 / 12931 / 130 km · (sin recuperar)
