-- BETANGAR — Carlos Alfredo Montiel Villalobos: UNA sola persona, UNA sola ficha.
-- CORRIDO EN PRODUCCIÓN el 2026-08-05 (hrkjddehqnzcqwlkklqm), autorizado por Máximo.
--
-- LO CONFIRMADO por RRHH (2026-08-05):
--   1. Es UNA sola persona: CARLOS ALFREDO MONTIEL VILLALOBOS (E706, C.I. V-19307663).
--   3. Alexander Paz SÍ trabajó la semana del 20 al 26/07 (no dieron la unidad).
--   2. Quedó sin respuesta al detalle; Máximo revisó el Excel y decidió: el 2º ayudante del
--      JAC-B008 en ese período es ALEXANDER ARTURO PAZ GONZALEZ.
--
-- POR QUÉ NO ALCANZABA CON UNIFICAR LAS FICHAS:
--   Siendo UNA sola persona, sus dos grafías salían el MISMO DÍA en CAMIONES DISTINTOS en 12 días
--   (14/07 al 31/07). Unificar y ya la dejaba cobrando los 26 viajes de la semana 21 — el número
--   que Máximo reportó como incorrecto. Primero hay que decir de quién es cada planilla.
--
-- EVIDENCIA QUE APARECIÓ AL VERIFICAR EL ALCANCE:
--   En la planilla 01015 (03/07, JAC-B008) el 2º ayudante junto a NESTOR BRIÑEZ ya era
--   ALEXANDER ARTURO PAZ GONZALEZ. Desde el 09/07 ese mismo puesto pasa a decir Montiel: es el
--   patrón de un nombre pisado, no de un cambio de personal.
--
-- ⛔ NO se toca `nomina_historial`: las semanas ya pagadas mantienen su monto (los Bs están
--    congelados a la tasa del día y re-guardar avanza cuotas de préstamos y multas). Lo único que
--    cambia es a quién se le atribuyen los viajes.
--    Ver [norma-nombre-corto-que-apunta-a-dos-personas] y [pnl-cerrado-mes-congelado].

-- ── RESPALDO ────────────────────────────────────────────────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_montiel_2026-08-05', jsonb_build_object(
         'planillas', (select jsonb_agg(to_jsonb(p)) from public.planillas p
                        where p.ay1 ilike '%MONTIEL%' or p.ay2 ilike '%MONTIEL%' or p.ay3 ilike '%MONTIEL%'
                           or p.ch ilike '%MONTIEL%'),
         'empleados', (select jsonb_agg(to_jsonb(e)) from public.empleados e
                        where e.id in ('E342','E706','E836'))
       )::text
on conflict (clave) do update set valor = excluded.valor;

-- ── PASO 1 — el B008 del 09/07 al 31/07 era Alexander Paz ───────────────────────────────────
-- ⚠️ Van `ay1` Y `ay2`: 21 filas lo tienen en ay2, pero la planilla 01131 (14/07) lo tiene en ay1
--    con ay2 vacío. Filtrando solo por ay2 esa fila quedaba atribuida a Montiel y el arreglo salía
--    incoherente consigo mismo. Total real: 22 filas.
update public.planillas
   set ay2 = 'ALEXANDER ARTURO PAZ GONZALEZ'
 where cam = 'JAC-B008' and f between '2026-07-09' and '2026-07-31'
   and ay2 ilike '%MONTIEL VILLALOBOS%';

update public.planillas
   set ay1 = 'ALEXANDER ARTURO PAZ GONZALEZ'
 where cam = 'JAC-B008' and f between '2026-07-09' and '2026-07-31'
   and ay1 ilike '%MONTIEL VILLALOBOS%';

-- Las de OTRAS unidades NO se tocan y quedan bien: JAC-B009 (11/07) y JAC-B005 (12/07) siguen
-- siendo Montiel, que es justo lo que resuelve los choques de esos dos días.

-- ── PASO 2 — una sola ficha de Montiel ──────────────────────────────────────────────────────
-- E706 CARLOS ALFREDO MONTIEL VILLALOBOS — C.I. V-19307663 → SE QUEDA
-- E342 CARLOS ALFREDO  MONTIEL           — SIN cédula      → SE DESACTIVA
-- (E342 era la única ficha activa sin cédula de las 61: nació de un import, no de RRHH.)
--
-- 2.a. La grafía corta pasa al nombre completo (15 filas: B004×1, B005×3, B012×11), así el pago
--      resuelve a E706 por coincidencia EXACTA y no por parecido.
--      El patrón termina en MONTIEL, así que NO alcanza a "…MONTIEL VILLALOBOS" (verificado: 0).
update public.planillas set ay1 = 'CARLOS ALFREDO MONTIEL VILLALOBOS' where ay1 ilike 'CARLOS ALFREDO%MONTIEL';
update public.planillas set ay2 = 'CARLOS ALFREDO MONTIEL VILLALOBOS' where ay2 ilike 'CARLOS ALFREDO%MONTIEL';
update public.planillas set ay3 = 'CARLOS ALFREDO MONTIEL VILLALOBOS' where ay3 ilike 'CARLOS ALFREDO%MONTIEL';

-- 2.b. La ficha duplicada se DESACTIVA, no se borra (quedó nombrada en nóminas ya guardadas).
update public.empleados set activo = false where id = 'E342';

-- ⏳ NO SE TOCA la `unidad` de E706 ni la de E836 (Paz): RRHH no declaró en qué unidad quedan.
--    Hoy E706 dice JAC-B005 y trabaja sobre todo en B012; Paz dice "ADM - Administrativo" y quedó
--    en B008. No se inventa: lo declara una persona ([norma-documento-no-afirma-lo-que-nadie-declaro]).

-- ── DESHACER ────────────────────────────────────────────────────────────────────────────────
--   select valor::jsonb -> 'planillas' from public.configuracion where clave='backup_montiel_2026-08-05';
-- trae la fila COMPLETA de cada planilla afectada; reponer desde ahí.
--   update public.empleados set activo = true where id = 'E342';
