-- BETANGAR — Las geocercas solo las toca un superadmin
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Máximo, al pedir que se pudieran editar: *«y que se pueda editar geocercas
-- solo yo»*. Medido antes de tocar, podían escribir:
--
--   INSERT / UPDATE : superadmin, admin (Keily Marín), revisor (Alejandra Virginia)
--   DELETE          : superadmin, admin
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE. Una geocerca no es un adorno del mapa: decide si
-- una parada de un camión cuenta como **descarga en el vertedero** o como **parada de
-- recolección en ruta**. Mover un polígono cambia, sin tocar un solo dato del GPS, el
-- número que se le muestra a la Alcaldía. Es una pieza de la evidencia, no de la
-- configuración — y por eso vale el mismo criterio que ya rige para el GPS: quien mira no
-- es quien define.
--
-- QUÉ CAMBIA. Escribir queda en `superadmin` (Máximo, Francisco Betancourt y la cuenta de
-- soporte de Maxware). Decidido por Máximo el 29/08 sobre la alternativa de cerrarlo a su
-- usuario: cerrarlo a una sola cuenta deja el sistema sin nadie que pueda corregir una
-- geocerca el día que él no esté.
--
-- ⛔ NO se toca `sit_sel`, y hay que decir por qué: hoy es `{anon,authenticated}` con
-- `USING (true)`, o sea que **las ubicaciones de la base, la oficina y los vertederos las
-- lee cualquiera con la llave pública** — la misma que reparte la página de un colegio.
-- Es el mismo defecto del hallazgo del 28/08 en una tabla que no estaba en aquella lista.
-- No se cierra acá porque `fichar.html` lee esta tabla y hay que medir antes con qué llave
-- entra: cerrarla a ciegas puede dejar a la gente sin poder fichar mañana, y un candado
-- que rompe la herramienta es peor que no tener candado. Queda anotado como pendiente.
--
-- Reversa al final.

begin;

alter policy sit_ins on public.sitios_asistencia
  with check (app_rol() = 'superadmin' and not app_solo_lectura());

alter policy sit_upd on public.sitios_asistencia
  using      (app_rol() = 'superadmin' and not app_solo_lectura())
  with check (app_rol() = 'superadmin' and not app_solo_lectura());

alter policy sit_del on public.sitios_asistencia
  using (app_rol() = 'superadmin' and not app_exige_token() and not app_solo_lectura());

commit;

-- ============================================================================
-- REVERSA:
--   alter policy sit_ins on public.sitios_asistencia
--     with check ((app_rol() = any (array['superadmin','revisor','admin'])) and not app_solo_lectura());
--   alter policy sit_upd on public.sitios_asistencia
--     using      ((app_rol() = any (array['superadmin','revisor','admin'])) and not app_solo_lectura())
--     with check ((app_rol() = any (array['superadmin','revisor','admin'])) and not app_solo_lectura());
--   alter policy sit_del on public.sitios_asistencia
--     using ((app_rol() = any (array['superadmin','admin'])) and not app_exige_token() and not app_solo_lectura());
-- Y volver `ROLES_SITIOS` en `mapa.html` a ['superadmin','admin','revisor'].
-- ============================================================================
