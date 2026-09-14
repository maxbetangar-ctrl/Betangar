-- ════════════════════════════════════════════════════════════════════════════
-- MOLDE · PASO 2 de 2 — cerrarle a `anon` las cuatro tablas que venían abiertas
-- en LOS CINCO clones.
--
-- ⛔ NO CORRER ESTE ARCHIVO ANTES DE:
--    1. haber corrido el PASO 1 (`molde_anon_paso1_sitio_publico_2026-09-14.sql`)
--       en ESTA base, y
--    2. haber DESPLEGADO el `fichar.html` que llama a `sitio_publico`, y haberlo
--       comprobado en la página viva.
--    Si se corre antes, el QR por sucursal deja de reconocer la sucursal y el
--    fichaje se guarda sin prueba de presencia, **sin un solo error a la vista**.
--
-- QUÉ SE CIERRA Y POR QUÉ SE PUEDE:
--
--   `asistencia`        · NINGUNA página la toca directo. Se escribe por el RPC
--                         `fichar_asistencia`. Lo que `fichar.html` sí usa es el
--                         BUCKET `asistencia` (`SB.storage.from('asistencia')`),
--                         que es otra cosa y no se toca acá.
--                         ⚠️ Esto fue un error de lectura el 14/09: se dio por
--                         hecho que `from('asistencia')` era la tabla. No lo era.
--   `porteria`          · solo `chofer.html`, que entra con `signInWithPassword`.
--   `cola_mensajes`     · solo `chofer.html`, con login. Tenía candado propio
--                         (`with check (wa_destino_permitido(telefono))`), así
--                         que nunca fue «cualquiera manda un WhatsApp a cualquier
--                         número» — pero un extraño sí podía encolarle mensajes a
--                         los números ya permitidos, o sea a la gente de la casa.
--   `sitios_asistencia` · la lee `fichar.html` SIN login. Por eso existe el paso 1.
--
-- `authenticated` NO se toca: conserva sus verbos y sus policies propias, que son
-- OTRAS (`*_sel2`, `vch_*`, `cme_*`…). Comprobado por `polroles`, no por el
-- nombre de la policy. [[norma-una-policy-sin-grant-no-otorga-nada]]
--
-- Reversa al final.
-- ════════════════════════════════════════════════════════════════════════════

revoke select, insert, update, delete on public.asistencia        from anon;
revoke select, insert, update, delete on public.porteria          from anon;
revoke select, insert, update, delete on public.cola_mensajes     from anon;
revoke select, insert, update, delete on public.sitios_asistencia from anon;

-- Las policies que son SOLO de `anon` quedan inertes sin grant, pero se van
-- igual: una policy viva sobre una puerta cerrada es una falsa alarma para el
-- que audite mañana. Comprobado con `polroles` una por una —no por el nombre—
-- que ninguna de estas alcanza a `authenticated`.
drop policy if exists chofer_anon_select on public.asistencia;
drop policy if exists chofer_anon_insert on public.asistencia;
drop policy if exists chofer_anon_update on public.asistencia;

drop policy if exists chofer_anon_select on public.porteria;
drop policy if exists chofer_anon_insert on public.porteria;
drop policy if exists chofer_anon_update on public.porteria;

drop policy if exists cm_anon_ins on public.cola_mensajes;

-- `destinos` no existe en Betangar (aseo urbano no tiene destinos de entrega), y
-- `drop policy if exists` sobre una tabla que no está NO es benigno: revienta con
-- «relation does not exist». El `if exists` perdona la policy, no la tabla.
do $$
begin
  if to_regclass('public.destinos') is not null then
    execute 'drop policy if exists destinos_anon_r on public.destinos';
    execute 'revoke select, insert, update, delete on public.destinos from anon';
  end if;
end $$;

-- ⛔ LA DE `sitios_asistencia` NO SE BORRA, Y NO ES UN OLVIDO.
--    Se llama `sit_sel` en Betangar y `sit_r` en los cuatro clones, y en las
--    cinco bases está puesta a **`authenticated` + `anon` a la vez**. En
--    Betangar es además la ÚNICA policy de SELECT que tiene el usuario
--    logueado: borrarla dejaba a la oficina sin poder ver sus propios sitios,
--    y al mapa sin geocercas.
--    El grant revocado arriba ya la deja inerte para `anon` —una policy sin
--    grant no otorga nada— y sigue sirviendo para el que entra con sesión.
--    Dos candados correctos que se cruzan no se aflojan: se le quita la llave
--    a uno, no se rompe la puerta de los dos.
--    [[norma-dos-candados-correctos-se-cruzan]] · [[norma-una-policy-sin-grant-no-otorga-nada]]

-- ============================================================================
-- REVERSA (si algo se rompe, primero devolver el grant; la policy después):
--   grant select, insert, update on public.<tabla> to anon;
-- ============================================================================
