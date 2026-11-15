-- ═══════════════════════════════════════════════════════════════════════════════
-- B008: la noche del 14/11 estaba guardada como una jornada de un minuto del 15
--
-- ⛔ CORRIGE UNA AFIRMACIÓN FALSA MÍA. La migración anterior
--    (`corregir_turnos_b008_14nov_2026-11-15.sql`) dejó escrito en la fila nocturna
--    del 14/11: «Esta unidad NO hizo turno nocturno el 14/11». **Es falso.** Sí lo
--    hizo: Yurvenis, 97 km (27219 → 27316).
--
--    Lo que pasó es la otra mitad del mismo defecto: como su propio turno de DÍA
--    ocupaba el cupo nocturno del 14, **no pudo abrir** el suyo. Lo registró a las
--    03:13 del 15 de una sola vez — salida 03:12 y llegada 03:13, un minuto — y quedó
--    como `15/11 nocturno`, que es una noche que no existió.
--
-- 📌 LA CONVENCIÓN DE LA CASA ES FECHAR LA NOCHE POR SU INICIO: el 13/11 nocturno va
--    de 17:32 a 02:39. Así que esta noche pertenece al **14/11**.
--
-- ⛔ LA HORA DE SALIDA NO SE INVENTA. Nunca se registró —no pudo—, así que queda en
--    `null` y la observación lo dice. Poner un «17:00 aproximado» sería fabricar un
--    dato con cara de medido. Los KILÓMETROS sí son reales y se conservan.
--    [[norma-falta-de-dato-no-es-un-dato]]
--
-- 📌 Respaldos previos:
--    `_respaldo-checklist-b008-14nov-2026-11-15.json`
--    `_respaldo-checklist-b008-15nov-2026-11-15.json`
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. La noche del 14 va a su cupo, con la observación CORREGIDA.
update public.checklist set
  conductor    = 'YURVENIS FRANCISCO BERMUDEZ SUAREZ',
  hora_salida  = null,
  hora_entrada = '03:12',
  km_salida    = '27219',
  km_entrada   = '27316',
  llenado_por  = 'chofer',
  observaciones = '[corregido 15/11/2026] Esta unidad SI hizo turno nocturno el 14/11 (97 km). '
    || 'No pudo abrirlo porque su propio turno de DIA ocupaba este cupo, por el defecto de la '
    || 'medianoche arreglado en v66; lo registro a las 03:13 del 15 como una jornada de un '
    || 'minuto. Se movio aca, que es donde va: la casa fecha la noche por su inicio. '
    || 'LA HORA DE SALIDA NUNCA SE REGISTRO y no se inventa: queda vacia.'
where cam = 'JAC-B008' and fecha = '2026-11-14' and turno = 'nocturno';

-- 2. El 15/11 queda vacío: esa noche no existió, era la del 14.
update public.checklist set
  hora_salida  = null,
  hora_entrada = null,
  km_salida    = null,
  km_entrada   = null,
  comb_salida  = null,
  comb_entrada = null,
  observaciones = '[corregido 15/11/2026] Lo que habia aca era la noche del 14/11, registrada '
    || 'a las 03:13 del 15 porque el cupo del 14 estaba ocupado (defecto de la medianoche, v66). '
    || 'Se movio al 14/11 nocturno. Esta fila queda vacia y el cupo libre.'
where cam = 'JAC-B008' and fecha = '2026-11-15' and turno = 'nocturno';
