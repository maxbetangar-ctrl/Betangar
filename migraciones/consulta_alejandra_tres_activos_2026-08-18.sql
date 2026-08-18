-- ============================================================================
-- CONSULTA A ALEJANDRA — los 3 que manejan y están marcados inactivos
--
-- ⛔ NO SE PREGUNTA LO QUE EL SISTEMA YA SABE. Antes de escribirle se comprobó:
--    · la nómina NO se ve afectada — paga por PLANILLA, y un inactivo que
--      aparece se paga igual y sale marcado ⚠️ (`calcNom`). Ella ya dijo que
--      cuadra, y tiene razón. Eso NO se le pregunta.
--    · `en_nomina` está en `true` en los tres y en Betangar no la lee nadie.
--    · `fegreso` está en NULL en los tres: nadie registró que se fueran.
--    Lo único que el sistema no puede contestar es POR QUÉ están en false.
--
-- Se le pregunta a ella y no al dueño porque es RRHH: la marca de activo la
-- lleva ella, y puede tener un motivo que el sistema no guarda.
--
-- Idempotente por `ref`.
-- ============================================================================

insert into cola_mensajes (tipo, telefono, mensaje, estado, ref)
select 'comunicado',
       regexp_replace(coalesce(nullif(e.whatsapp,''), e.tel), '[^0-9]', '', 'g'),
  'Buenas Alejandra, soy Máximo.' || chr(10) || chr(10) ||
  'Una consulta puntual, no es un problema de nómina — eso ya lo revisé y está bien.' || chr(10) || chr(10) ||
  'En el sistema hay tres personas marcadas como INACTIVAS que sin embargo están manejando ' ||
  'todos los días, con su checklist cargado:' || chr(10) ||
  '• HELY URDANETA' || chr(10) ||
  '• RICHARD VILLALOBOS' || chr(10) ||
  '• MANUEL GONZALEZ' || chr(10) || chr(10) ||
  'Ninguno tiene fecha de egreso cargada, así que no parece que se hayan ido.' || chr(10) || chr(10) ||
  '¿Sabes si están así por alguna razón, o es que quedó la marca mal puesta?' || chr(10) || chr(10) ||
  'Lo pregunto porque esa marca no afecta lo que cobran, pero sí hace que el sistema ' ||
  'no los tome en cuenta para otras cosas. Si no hay motivo, la corrijo y listo.' || chr(10) || chr(10) ||
  'Gracias.' || chr(10) || chr(10) ||
  'Máximo',
  'pendiente',
  'consulta-tres-activos-20260818'
from empleados e
where e.nombre = 'VIRGINIA ALEJANDRA CASTILLO MEDINA'
  and not exists (select 1 from cola_mensajes c where c.ref = 'consulta-tres-activos-20260818');
