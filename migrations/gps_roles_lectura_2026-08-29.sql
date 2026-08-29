-- BETANGAR — GPS: quién puede VER el recorrido de la flota
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Al ponerle el enlace al mapa en el menú, Máximo preguntó quién tiene
-- acceso. Medido contra `btg_usuarios` y la policy de `gps_posiciones`: lo veían 11
-- usuarios, y quedaban afuera justo los perfiles que trabajan con la operación —
-- `revisor` (Alejandra Virginia, la que revisa y coteja), `operativo` (Samuel Mendoza
-- y el Jefe Operativo, patio y combustible) y `mecanico` (Juan Carlos Dávila, que
-- necesita el kilometraje y el ralentí para mantenimiento).
--
-- ⚠️ Y había una contradicción escrita en el propio `mapa.html`: el botón «Marcar
-- sitio» se le ofrecía a `revisor` —porque la RLS de `sitios_asistencia` sí lo deja
-- escribir— sobre un mapa cuyas posiciones no podía leer. Se resuelve dándole la
-- lectura, no quitándole el botón.
--
-- QUÉ CAMBIA. Se suman `revisor`, `operativo` y `mecanico` a la LECTURA de
-- `gps_posiciones`, `gps_dia` y `gps_equipos`. Decidido por Máximo el 29/08.
--
-- ⛔ QUÉ NO CAMBIA, A PROPÓSITO:
--  · `gps_sync_estado` NO se amplía. Es el diagnóstico del conector (cuándo corrió,
--    con qué error), no información de la operación: sigue en superadmin, admin,
--    directivo y auditor.
--  · NADIE gana INSERT, UPDATE ni DELETE. El GPS lo escribe SOLO el conector con la
--    llave de servicio. Una evidencia que la oficina puede retocar no prueba nada
--    ante la Alcaldía, y eso es exactamente para lo que existe este dato.
--  · `vigilante`, `rrhh`, `asistencia` y las cuentas `demo_*` siguen sin acceso.
--
-- Reversa al final.

begin;

alter policy gps_posiciones_sel on public.gps_posiciones
  using (app_rol() = any (array[
    'superadmin','admin','operador','visualizador','directivo','auditor',
    'revisor','operativo','mecanico'
  ]));

alter policy gps_dia_sel on public.gps_dia
  using (app_rol() = any (array[
    'superadmin','admin','operador','rrhh','visualizador','directivo','auditor',
    'revisor','operativo','mecanico'
  ]));

alter policy gps_equipos_sel on public.gps_equipos
  using (app_rol() = any (array[
    'superadmin','admin','operador','rrhh','visualizador','directivo','auditor',
    'revisor','operativo','mecanico'
  ]));

commit;

-- ============================================================================
-- REVERSA: volver a dejar cada policy con su lista original —
--   gps_posiciones: superadmin, admin, operador, visualizador, directivo, auditor
--   gps_dia / gps_equipos: las mismas + rrhh
-- y sacar 'revisor','operativo','mecanico' de ROLES_MAPA en `mapa.html`.
-- ============================================================================
