-- ═══════════════════════════════════════════════════════════════════════════
-- LA CUBICACIÓN LLEGA HASTA EL TOPE DEL TANQUE
-- 06/11/2026
--
-- 🔴 QUÉ PASABA. La tabla del JAC termina en **52 cm → 596,06 L** y el tanque
--    mide **52,5 cm con 600 L** de capacidad. Ese último medio centímetro no
--    estaba tabulado, así que se extrapolaba plano: un tanque lleno hasta el
--    borde se contaba como 596,06 L en vez de 600.
--
--    Y hay 9 lecturas de 53 cm en el período auditado. La base las topa a 52,5
--    (correcto: la regla tiene 2 cm de gracia para el tanque al borde) pero
--    después busca el punto 53 de la tabla, que no existe.
--
-- ⛔ POR QUÉ SE AGREGA UN PUNTO EN 53 Y NO EN 52,5. `tanque_veredicto` hace
--    `floor`/`ceil` de la altura para buscar los dos puntos vecinos, así que
--    una clave «52.5» NUNCA la encontraría — pero el `_acCubicar` del
--    navegador, que ordena las claves como números, SÍ. Las dos
--    implementaciones empezarían a dar números distintos para el mismo
--    centímetro, que es justo lo que se midió hoy que NO pasa.
--    El punto 53 es sólo el ancla de la interpolación: nunca se devuelve,
--    porque la altura se topa antes en 52,5.
--
-- 📐 El valor: se elige para que la interpolación en el tope dé exactamente la
--    capacidad declarada.
--      596,06 + (603,94 − 596,06) × 0,5 = 600,00 L  ✅
--    O sea que 52,5 cm = 600 L, que es lo que dice la ficha del tanque. No se
--    inventa un dato: se hace que la tabla y la capacidad digan lo mismo.
-- ═══════════════════════════════════════════════════════════════════════════

update combustible_tanques_config
   set tabla_cubicacion = tabla_cubicacion || jsonb_build_object('53', 603.94)
 where tipo = 'vehiculo'
   and altura_max_cm = 52.5
   and tabla_cubicacion->>'53' is null;

-- Comprobar que el tope da la capacidad:
--   select tanque_veredicto('JAC-B009', 52.5)->>'litros';   -- 600.00
--   select tanque_veredicto('JAC-B009', 53)->>'litros';     -- 600.00 (topado)
