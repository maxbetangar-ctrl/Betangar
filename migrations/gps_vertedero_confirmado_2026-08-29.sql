-- BETANGAR — El vertedero queda CONFIRMADO, y se apaga el que se había deducido solo
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Máximo miró el mapa y confirmó el polígono: *«si ese es el vertedero está
-- bien»*. Hasta hoy había DOS geocercas de vertedero encimadas y en la pantalla salían
-- las dos etiquetas pegadas:
--
--   id 3 · «VERTEDERO (deducido del GPS · SIN CONFIRMAR)» · radio 300 m
--   id 4 · «VERTEDERO DE LA CONCEPCIÓN»                   · radio 1075 m
--
-- Medido: los centros están a **228 m** y el deducido queda **enteramente adentro** del
-- confirmado (228 + 300 < 1075). O sea que no cubre un metro que el otro no cubra: es
-- el rastro de cuando se dedujo la ubicación a partir de dónde se paraban los camiones,
-- antes de que alguien pudiera decir dónde era.
--
-- QUÉ CAMBIA. El deducido se **apaga** (`activo=false`), no se borra: el `false` deja
-- ver que existió y por qué, y se vuelve a prender con una línea si hiciera falta.
-- ⛔ Borrar filas en esta base lo corre Máximo, no un script.
--
-- El nombre del bueno pierde el «(CONFIRMAR)» que llevaba en la nota, porque ya está
-- confirmado por quien podía hacerlo: alguien que conoce el sitio.
--
-- ⚠️ Apagarlo NO deja ningún hueco de cobertura: cualquier parada que caía en el
-- deducido cae también en el confirmado, que es más grande y lo contiene.
--
-- Reversa al final.

begin;

update public.sitios_asistencia
   set activo = false,
       nombre = 'VERTEDERO (deducido del GPS, 15/08) — reemplazado por el confirmado'
 where id = 3;

-- ⚠️ El id 4 NO se toca: su nombre ya es el correcto. El «(CONFIRMAR)» que se veía en
-- la pantalla NO era parte de su nombre — era la etiqueta del id 3 («…SIN CONFIRMAR»)
-- dibujada encima, porque los dos círculos están a 228 m. Al apagar el id 3 desaparece
-- sola. (La tabla no tiene columna de notas: `sitios_asistencia` es id, nombre, lat,
-- lng, radio_m, es_oficina, activo, created_at, tipo.)

commit;

-- ============================================================================
-- REVERSA:
--   update public.sitios_asistencia
--      set activo=true, nombre='VERTEDERO (deducido del GPS · SIN CONFIRMAR)'
--    where id=3;
-- ============================================================================
