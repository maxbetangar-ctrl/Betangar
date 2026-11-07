-- ═══════════════════════════════════════════════════════════════════════════
-- LA SURTIDA TAMBIÉN SABE DE QUÉ TURNO ES
-- 06/11/2026
--
-- 🔴 POR QUÉ. El consumo de una jornada no es sólo «salió con X, llegó con Y»:
--    es `salida − llegada + lo que le echaron en el camino`. La auditoría le
--    sumaba a CADA jornada del día TODAS las surtidas de ese día
--    (`_acEntradas(cam, fecha, fecha)`), porque antes había una sola jornada
--    por día y eso era exacto.
--
--    Con dos turnos deja de serlo, y de la peor manera: los mismos litros se
--    cuentan DOS VECES, una por turno. Un camión que cargó 350 L y lo manejan
--    dos choferes aparece consumiendo 350 L de más — repartidos entre los dos,
--    acusando a los dos.
--
-- ⛔ Y NO SE RESUELVE POR LA HORA. `hora` viene en null en toda carga tecleada
--    en lote desde un papel (40 filas, 6.862 L, un solo volcado el 18/08), y el
--    histórico `gasoil` entero es de esa clase. Una regla que dependa de la
--    hora falla justo en los datos viejos.
--    [[norma-created-at-no-es-la-hora-del-hecho]]
--
-- ⇒ Se deduce del CHOFER, que la surtida sí trae: es la misma regla que
--   resolvió 2.695 de 2.711 mediciones al meter el turno en su llave.
-- ═══════════════════════════════════════════════════════════════════════════

alter table surtidas add column if not exists turno text;

comment on column surtidas.turno is
  'Turno al que se le carga esta surtida. Se deduce del chofer contra el checklist del dia. NULL = no se pudo deducir: se reparte entre los turnos del dia en vez de contarse dos veces.';

-- ⛔ NULL A PROPÓSITO, y no `default ''diurno''`. Una surtida que no se pudo
--    atribuir NO es del diurno: es de turno DESCONOCIDO, y decirle diurno le
--    cargaría a ese turno litros que capaz no uso. La falta de dato no es un
--    dato. [[norma-falta-de-dato-no-es-un-dato]]
update surtidas s
   set turno = c.turno
  from checklist c
 where c.cam = s.cam
   and c.fecha::date = s.fecha::date
   and upper(trim(c.conductor)) = upper(trim(coalesce(s.chofer,'')))
   and c.turno is not null
   and s.turno is null;

-- Las de un dia con UN SOLO turno son de ese turno, sin ambiguedad posible.
update surtidas s
   set turno = x.turno
  from (select c.cam, c.fecha::date f, min(c.turno) turno
          from checklist c
         group by c.cam, c.fecha::date
        having count(distinct c.turno) = 1) x
 where x.cam = s.cam
   and x.f = s.fecha::date
   and s.turno is null;

-- ⛔ NO se crea indice unico aca. Una unidad PUEDE surtir dos veces en el mismo
--    turno (lo hace: se recarga a mitad de ruta). La surtida no es un estado
--    del dia, es un hecho que se repite.

-- Y las que quedaron sin deducir pero son ANTERIORES al 04/11/2026: ese dia
-- arrancaron los dos turnos. Antes habia uno solo, asi que `diurno` ahi es un
-- hecho y no una suposicion. Las 10 que quedaban son de julio y octubre, de
-- dias sin checklist cargado para esa unidad.
update surtidas
   set turno = 'diurno'
 where turno is null
   and fecha::date < date '2026-11-04';
