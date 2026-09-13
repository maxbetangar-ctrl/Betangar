-- ============================================================================
-- SE SURTE CUANDO SE CONSIGUE EL GASOIL, NO UN DÍA FIJO   ·   12/09/2026
--
-- 🔴 CORRIGE UN COMENTARIO QUE ESCRIBÍ HOY MISMO, MAL. Hace un rato dejé en el
--    comentario de estas tablas que las surtidas «caen todos los SÁBADOS sin
--    faltar uno». Máximo lo corrigió en seco:
--
--      «no es así, no siempre se surte el mismo día, ojo, es mera coincidencia.
--       Debe permitir echar cualquier día. Recordá que esto es Venezuela y es
--       CUANDO SE CONSIGA EL GASOIL.»
--
-- ⛔ POR QUÉ IMPORTA Y NO ES UN DETALLE DE REDACCIÓN. Un patrón escrito en la
--    base se convierte, tarde o temprano, en un chequeo: alguien ve «todos los
--    sábados» y programa una alarma de «esta semana no se surtió», o peor, un
--    candado que valide el día. El día que el gasoil aparezca un martes, esa
--    pieza da una alarma falsa o directamente no deja cargar — y sería yo el que
--    lo sembró. Siete sábados seguidos son una COINCIDENCIA de disponibilidad,
--    no una regla del negocio.
--    [[norma-candado-unico-codifica-un-supuesto]]
--
-- ✅ COMPROBADO ANTES DE ESCRIBIR ESTO: el sistema **ya** permite cualquier día.
--    · `surtidas` no tiene ningún UNIQUE ni CHECK con fecha adentro (solo la PK).
--    · `surtida_registrar()` toma la fecha DEL PAYLOAD
--      (`nullif(p->>'fecha','')::date`): no la impone ni la valida contra el día
--      de la semana.
--    · Sus únicos topes son por DUPLICADO (misma unidad y mismos litros dentro
--      de una hora) y por LITROS (capacidad del tanque × 1.5, o 2.000 por
--      defecto). Ninguno mira el calendario.
--    ⇒ No hay nada que destrabar. Lo que hay que arreglar es lo ESCRITO.
-- ============================================================================

comment on table public.surtidas is
  '⛽ LA VERDAD DEL COMBUSTIBLE desde el 18/07/2026 (`configuracion.surtidas_corte`). '
  'La carga el CHOFER desde su app, una fila por surtida. Reemplaza a `gasoil`, que '
  'quedó congelada a propósito — ver el comentario de aquella. '
  '⛔ NO HAY UN DÍA NI UNA CADENCIA: se surte CUANDO SE CONSIGUE EL GASOIL, y en '
  'Venezuela eso es cualquier día. Si ves varias semanas cayendo el mismo día, es '
  'COINCIDENCIA de disponibilidad, no una regla. ⚠️ No programes una alarma de «esta '
  'semana no se surtió» ni un candado que valide el día: el día que aparezca gasoil un '
  'martes te da una alarma falsa o no deja cargar. Los topes que SÍ existen son por '
  'duplicado (misma unidad y litros dentro de una hora) y por litros (capacidad del '
  'tanque × 1.5); ninguno mira el calendario, y así tiene que seguir.';

comment on table public.gasoil is
  '⛔ JUBILADA EL 18/07/2026 — NO es un error que esté quieta. Desde esa fecha la '
  'verdad del combustible es la tabla `surtidas` (lo que carga el CHOFER en su app). '
  'El gate está en app.js: `_postCorte` compara la fecha de la planilla contra '
  '`configuracion.surtidas_corte` y, si es posterior, NO empuja el gasoil acá — a '
  'propósito, para no contar el mismo litro dos veces en rentabilidad. '
  'Las pocas filas posteriores al corte son cargas sueltas de otro camino, no un goteo '
  'de la planilla. ⚠️ ANTES DE DAR UNA ALARMA porque esta tabla no crece: mirá '
  '`surtidas`. Medido el 12/09/2026: ago 5 filas acá contra 31 surtidas (9.419 L) y '
  'sep 1 contra 19 (7.087 L) — el volumen se mudó, no desapareció. '
  '⛔ Y no midas el hueco por CALENDARIO: no hay día fijo de surtida, se echa cuando se '
  'consigue el gasoil. NO SE BORRA: guarda el histórico de marzo a julio, que es el que '
  'usan los informes de esos meses.';
