-- ════════════════════════════════════════════════════════════════════════════════
-- CERRAR LA ESCRITURA ABIERTA — 02/11/2026
--
-- POR QUÉ. Midiendo qué hacía falta para darle a un tercero (el proveedor de GPS)
-- una cuenta que SOLO MIRE, apareció que el candado de sólo lectura de la casa
-- —`app_solo_lectura()`, que hoy cubre al rol `auditor`— lo respetan 111 políticas
-- de escritura… pero NO todas. Las que no lo consultan dejan escribir a un rol de
-- sólo lectura, y por lo tanto la garantía «la auditora sólo mira» no se cumplía
-- en esas tablas. [[norma-probar-el-camino-no-la-pieza]]
--
-- ⛔ EL CASO GRAVE, Y NO ERA EL DEL PROVEEDOR: `empleado_sueldos` tenía UNA SOLA
--    política, `p_empleado_sueldos`, PERMISSIVE, `cmd = ALL`, con `qual = true` y
--    `with_check = true`, para `authenticated`. Y los GRANT de `authenticated`
--    estaban los cuatro (select/insert/update/delete). Los DOS candados en serie
--    abiertos: cualquier cuenta con sesión —`vigilante`, `asistencia`, `mecanico`
--    y también `auditor`— podía LEER Y MODIFICAR los 11 sueldos en dólares
--    (`empleado_id`, `monto_usd`, `forma_pago`).
--    ✅ `anon` NO tiene grant sobre la tabla: no era una fuga hacia afuera.
--    Mirar sólo las policies habría sido falsa alarma; se miraron los grants
--    también, como enseña `maxware-tools/anon-lee-tablas.mjs`.
--
-- QUIÉN DECIDIÓ LA LISTA. Máximo, hoy: los sueldos los ven **superadmin, admin y
-- rrhh**. No es una decisión técnica y no se eligió por omisión.
-- ⚠️ Queda AFUERA `revisor` (Alejandra), que en el resto de las tablas de la casa
--    sí figura. Fue la lista que Máximo eligió; si la quiere adentro, se agrega.
-- ⚠️ Queda AFUERA `operador`, que hoy tiene el módulo `empleados` en el menú. La
--    ficha del empleado escribe el sueldo en `_sueldoGuardar` (app.js:20946), así
--    que a un operador la base le va a rechazar ESE campo (la ficha se guarda
--    igual; el sueldo no). La pantalla tiene que dejar de ofrecer el campo a quien
--    no lo puede escribir, o vuelve a ser un formulario que termina en «permiso
--    denegado». [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
-- ORDEN DE LOS PASOS, A PROPÓSITO: primero se CREAN las políticas restrictivas y
-- sólo después se BORRA la permisiva. Mientras las dos coexisten, la permisiva
-- sigue dejando pasar (las PERMISSIVE se suman con OR), así que no hay un instante
-- en que la nómina quede trabada. Al revés habría un hueco de denegación.
--
-- ⛔ LO QUE NO SE TOCA, Y POR QUÉ:
--   · `auditoria` (INSERT con `true`): se DEJA abierta a propósito. Es la bitácora
--     y tiene que aceptar la huella de CUALQUIER rol. Cerrarla a los roles de sólo
--     lectura significaría que la visita de un tercero no deja rastro — y el rastro
--     de quién entró es justo lo que queremos de un invitado. El riesgo inverso
--     (que un invitado escriba una línea falsa) es menor que perder el registro.
--   · `edu_health_check` (ALL con `true`): NO es de Betangar, es de Geppetto/Ranita
--     en la misma base. No se toca lo ajeno desde una migración de Betangar.
--     [[clon-no-puede-mostrar-ni-tocar-otro-cliente]]
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. empleado_sueldos: partir el ALL permisivo en lectura y escritura ─────────
-- Nombres y forma copiados del patrón de `empleados` (btg_rol_lectura / btg_rol_ins
-- / btg_rol_upd / btg_del_superadmin) para que no haya dos estilos en la misma base.

create policy btg_rol_lectura on public.empleado_sueldos
  for select to authenticated
  using (app_rol() = any (array['superadmin'::text,'admin'::text,'rrhh'::text]));

create policy btg_rol_ins on public.empleado_sueldos
  for insert to authenticated
  with check (
    app_rol() = any (array['superadmin'::text,'admin'::text,'rrhh'::text])
    and not app_solo_lectura()
  );

create policy btg_rol_upd on public.empleado_sueldos
  for update to authenticated
  using (
    app_rol() = any (array['superadmin'::text,'admin'::text,'rrhh'::text])
    and not app_solo_lectura()
  )
  with check (
    app_rol() = any (array['superadmin'::text,'admin'::text,'rrhh'::text])
    and not app_solo_lectura()
  );

-- Borrar un sueldo es borrar un tramo del historial: queda donde está el resto de
-- lo destructivo de la casa, detrás de `app_puede_borrar()` (superadmin sin token
-- pendiente).
create policy btg_del_superadmin on public.empleado_sueldos
  for delete to authenticated
  using (app_puede_borrar() and not app_solo_lectura());

-- Y ahora sí, se va la permisiva. Las cuatro de arriba ya están en pie.
drop policy p_empleado_sueldos on public.empleado_sueldos;

-- ── 2. llantas_mediciones: el INSERT estaba en `true` ──────────────────────────
-- Se deja que escriba cualquier rol (así trabaja hoy: cualquiera que mide, carga),
-- pero no un rol de sólo lectura. Cambio mínimo: no le quita el permiso a nadie
-- que lo esté usando. [[norma-arreglar-el-mecanismo-no-el-caso]]
alter policy llantas_med_auth_ins on public.llantas_mediciones
  with check (not app_solo_lectura());

-- ── 3. El requisitorio: seis políticas con `app_rol() IS NOT NULL` ─────────────
-- «Tener un rol cualquiera» incluye a los de sólo lectura. Se le suma el candado y
-- nada más: quien escribía sigue escribiendo.
alter policy requisiciones_ins on public.requisiciones
  with check (app_rol() is not null and not app_solo_lectura());

alter policy requisiciones_upd on public.requisiciones
  using (app_rol() is not null and not app_solo_lectura())
  with check (app_rol() is not null and not app_solo_lectura());

alter policy req_lineas_ins on public.req_lineas
  with check (app_rol() is not null and not app_solo_lectura());

alter policy req_lineas_upd on public.req_lineas
  using (app_rol() is not null and not app_solo_lectura())
  with check (app_rol() is not null and not app_solo_lectura());

alter policy req_cotizaciones_ins on public.req_cotizaciones
  with check (app_rol() is not null and not app_solo_lectura());

alter policy req_cotizaciones_upd on public.req_cotizaciones
  using (app_rol() is not null and not app_solo_lectura())
  with check (app_rol() is not null and not app_solo_lectura());
