-- ═══════════════════════════════════════════════════════════════════════════════
-- B008, 14/11/2026: el DÍA estaba guardado en el cupo de la NOCHE
--
-- 🔴 POR QUÉ. Máximo, 14/11: los choferes «unos no pueden cerrar, otros abrir». El
--    B008 es el caso completo del defecto que arregló v66 (la jornada le gana al
--    calendario), y dejó DOS filas mal:
--
--      14/11 diurno   02:39 → 02:41   km 27014 → 27119
--      14/11 nocturno 06:08 → 15:58   km 27119 → 27219
--
-- ⛔ LA PRIMERA NO ES UNA JORNADA DE DOS MINUTOS: es un DUPLICADO EXACTO de la noche
--    del 13 (`13/11 nocturno`, 17:32 → 02:39, km 27014 → 27119). Mismos kilómetros,
--    misma hora de llegada. Yurvenis cruzó la medianoche, el teléfono lo tiró al día
--    nuevo y ahí volvió a escribir lo de su noche. ⇒ **105 km contados dos veces.**
--
-- ⛔ Y LA SEGUNDA ES SU TURNO DE DÍA, metido en el cupo nocturno porque el teléfono
--    se quedó en modo noche. Con ese cupo ocupado y cerrado, quien manejara esa noche
--    no podía abrir.
--
-- ⇒ Se corrige dejando cada cosa en su lugar:
--      14/11 diurno   ← el día de verdad (06:08 → 15:58, 27119 → 27219)
--      14/11 nocturno ← vaciada: esa noche NO hubo turno nocturno en esta unidad
--
-- ⛔ NO SE BORRA NINGUNA FILA. La nocturna queda vacía y con su explicación en
--    `observaciones`, no eliminada: un registro que desaparece no se puede auditar, y
--    la fila vacía además deja el cupo libre para la app.
--
-- 📌 Respaldo de las dos filas ANTES de tocarlas:
--    `maxware-tools/_respaldo-checklist-b008-14nov-2026-11-15.json`
--
-- ⚠️ ESTO NO ARREGLA LA CAUSA, que ya está arreglada en v66 (desplegada 15/11 04:00).
--    Esto limpia el dato que el defecto dejó mientras estuvo vivo.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. El día de verdad pasa al cupo diurno, pisando el duplicado de la noche del 13.
update public.checklist set
  hora_salida  = '06:08',
  hora_entrada = '15:58',
  km_salida    = '27119',
  km_entrada   = '27219',
  comb_salida  = '1/2',
  comb_entrada = '1/4',
  observaciones = trim(both ' ' from coalesce(observaciones,'') ||
    ' [corregido 15/11/2026: esta fila tenia DUPLICADA la noche del 13/11 (02:39-02:41, ' ||
    'km 27014-27119). Se le puso el turno de DIA real, que habia quedado guardado en el ' ||
    'cupo nocturno por el defecto de la medianoche, arreglado en v66.]')
where cam = 'JAC-B008' and fecha = '2026-11-14' and turno = 'diurno';

-- 2. El cupo nocturno queda VACIO: esa noche esta unidad no hizo turno de noche.
update public.checklist set
  hora_salida  = null,
  hora_entrada = null,
  km_salida    = null,
  km_entrada   = null,
  comb_salida  = null,
  comb_entrada = null,
  observaciones = trim(both ' ' from coalesce(observaciones,'') ||
    ' [corregido 15/11/2026: lo que habia aca era el turno de DIA (06:08-15:58), que el ' ||
    'telefono guardo como nocturno por el defecto de la medianoche (v66). Se movio al cupo ' ||
    'diurno. Esta unidad NO hizo turno nocturno el 14/11.]')
where cam = 'JAC-B008' and fecha = '2026-11-14' and turno = 'nocturno';
