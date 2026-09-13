-- ============================================================================
-- QUE LA TABLA `gasoil` DIGA QUE ESTÁ JUBILADA   ·   12/09/2026   ·   BETANGAR
--
-- 🔴 POR QUÉ EXISTE. Hoy reporté dos veces «gasoil parado desde el 02/09, diez
--    días, y es plata». **Era falso.** `gasoil` está jubilada desde el
--    **18/07/2026** por el gate de corte de `app.js`:
--
--      var _postCorte = cfg.surtidasCorte && fechaStr >= cfg.surtidasCorte;
--      if (gasoilV > 0 && !_postCorte) GASOIL.push(...)   // ya no empuja
--
--    y `configuracion.surtidas_corte = '2026-07-18'`. Desde esa fecha la verdad
--    del combustible es la **SURTIDA del chofer**, y el gasoil de la planilla NO
--    se empuja a propósito, para no contar el mismo litro dos veces.
--
-- 📌 MEDIDO, que es lo que lo prueba:
--      gasoil    jun 91 filas / 9.784 L · jul 167 / 18.989 · ago 5 / 1.113 · sep 1 / 1.000
--      surtidas  jul 45 / 7.160 (desde el 18) · ago 31 / 9.419 · sep 19 / 7.087
--    ⇒ El volumen se mudó, no desapareció. Y las surtidas caen **todos los
--      sábados sin faltar uno** desde el 01/08: 01, 08, 15, 22 y 29 de agosto,
--      05 y 12 de septiembre. El registro está completo y al día.
--
-- ⛔ LO QUE FALLÓ NO FUE EL DATO: FUE QUE NADIE PREGUNTÓ A LA TABLA. Para saber
--    que `gasoil` estaba jubilada había que leer un `if` en medio de 28.000
--    líneas de `app.js` y cruzarlo con una fila de `configuracion`. Una tabla
--    que se quedó quieta y no dice por qué **parece un sistema roto**, y el que
--    la mire dentro de seis meses va a dar la misma alarma falsa que di yo.
--
-- ⇒ Se hace lo mismo que el 18/08 con `activo` vs `en_nomina`: que la propia
--   tabla conteste. No cambia ni un dato ni una conducta.
--   [[norma-la-pieza-dice-lo-que-no-hace]] · [[norma-fuente-unica-datos]]
-- ============================================================================

comment on table public.gasoil is
  '⛔ JUBILADA EL 18/07/2026 — NO es un error que esté quieta. Desde esa fecha la '
  'verdad del combustible es la tabla `surtidas` (lo que carga el CHOFER en su app). '
  'El gate está en app.js: `_postCorte` compara la fecha de la planilla contra '
  '`configuracion.surtidas_corte` y, si es posterior, NO empuja el gasoil acá — a '
  'propósito, para no contar el mismo litro dos veces en rentabilidad. '
  'Las pocas filas posteriores al corte son cargas sueltas de otro camino, no un goteo '
  'de la planilla. ⚠️ ANTES DE DAR UNA ALARMA porque esta tabla no crece: mirá '
  '`surtidas`. Medido el 12/09/2026: ago 5 filas acá contra 31 surtidas (9.419 L), '
  'sep 1 contra 19 (7.087 L), y las surtidas caen todos los SÁBADOS sin faltar uno '
  'desde el 01/08. NO SE BORRA: guarda el histórico de marzo a julio, que es el que '
  'usan los informes de esos meses.';

comment on column public.gasoil.src is
  'De dónde salió el litro. `Tumaca` = del tanque del patio (movimiento interno: esa '
  'plata ya se gastó al llenar el tanque, contarla otra vez es contarla dos veces). '
  '`Estacion` = compra a una estación de servicio, que SÍ es gasto. '
  'Ver el comentario de la tabla: después del 18/07/2026 esto vive en `surtidas`.';

comment on table public.surtidas is
  '⛽ LA VERDAD DEL COMBUSTIBLE desde el 18/07/2026 (`configuracion.surtidas_corte`). '
  'La carga el CHOFER desde su app, una fila por surtida. Reemplaza a `gasoil`, que '
  'quedó congelada a propósito — ver el comentario de aquella. En Betangar se surte en '
  'el patio propio, del tanque del galpón.';
