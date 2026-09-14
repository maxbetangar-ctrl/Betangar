-- BETANGAR — GPS: `rrhh` pasa a ver el recorrido de la flota
-- Fecha: 2026-09-14
--
-- ⚠️ ESTE REPO ES PÚBLICO: acá no se nombra a nadie. La persona concreta y el
--    pedido textual quedan en la bitácora, que no se publica.
--    [[norma-fixture-de-prueba-es-dato-de-cliente]]
--
-- QUÉ PASÓ. Máximo pidió darle acceso al mapa a una persona de RRHH. El rol
-- `rrhh` era uno de los tres que el 29/08 se dejaron AFUERA a propósito, junto
-- con `vigilante` y `asistencia` (ver `gps_roles_lectura_2026-08-29.sql`).
--
-- ⚠️ ESTO REVIERTE UNA DECISIÓN ANTERIOR, no llena un olvido. Aquella decía
--    textualmente «`vigilante`, `rrhh`, `asistencia` y las cuentas `demo_*`
--    siguen sin acceso». La nueva es de Máximo y es de hoy; queda escrito para
--    que dentro de tres meses nadie lea la migración vieja y crea que esto se
--    coló por descuido.
--
-- QUÉ CAMBIA. UNA sola policy: `gps_posiciones_sel`. `rrhh` YA tenía `gps_dia`
-- y `gps_equipos` desde el 29/08 — le faltaba justo el recorrido, que es lo que
-- dibuja el mapa. Por eso el síntoma era entrar y ver la tapa de «no tenés
-- permiso» con todo lo demás ya concedido.
--
-- ⛔ QUÉ NO CAMBIA, A PROPÓSITO:
--  · `gps_sync_estado` NO se amplía. Es el diagnóstico del conector (cuándo
--    corrió, con qué error), no información de la operación.
--  · `rrhh` NO gana INSERT, UPDATE ni DELETE. El GPS lo escribe SOLO el
--    conector con la llave de servicio: una evidencia que la oficina puede
--    retocar no prueba nada ante la Alcaldía.
--  · `vigilante`, `asistencia` y las `demo_*` siguen sin acceso.
--
-- ⚠️ SON DOS LUGARES. La lista `ROLES_MAPA` de `mapa.html` tiene que sumar
--    'rrhh' en la MISMA entrega, o la persona entra y la pantalla le dice que
--    no tiene permiso aunque la base ya la deje: el navegador no puede
--    preguntarle a Postgres quién puede leer qué.
--
-- Reversa al final.

begin;

alter policy gps_posiciones_sel on public.gps_posiciones
  using (app_rol() = any (array[
    'superadmin','admin','operador','visualizador','directivo','auditor',
    'revisor','operativo','mecanico','rrhh'
  ]));

commit;

-- ============================================================================
-- REVERSA: sacar 'rrhh' de la lista de arriba y de `ROLES_MAPA` en `mapa.html`.
--   alter policy gps_posiciones_sel on public.gps_posiciones
--     using (app_rol() = any (array[
--       'superadmin','admin','operador','visualizador','directivo','auditor',
--       'revisor','operativo','mecanico'
--     ]));
-- ============================================================================
