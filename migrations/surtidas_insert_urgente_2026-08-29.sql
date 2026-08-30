-- 🔴 BETANGAR — URGENTE: `surtidas` no tenía policy de INSERT y NADIE podía cargar combustible
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Los choferes llevaban toda la tarde sin poder registrar la surtida. Se
-- encontró y arregló un `ReferenceError` en la app (una función fantasma del candado del
-- precio, del 26/08) y **seguían sin poder**. Medido entonces contra la base:
--
--   tabla                    RLS   policies INSERT   policies total
--   checklist                sí          2                7
--   viajes_chofer            sí          2                7
--   combustible_mediciones   sí          2                7
--   surtidas                 sí        **0**            **3**
--
-- Con RLS activo y **cero policies de INSERT, nadie puede insertar**: ni el chofer, ni la
-- oficina, ni nadie. Y hasta el 22/08 se insertaba sin problema (73 surtidas cargadas),
-- así que estas policies se perdieron en algún momento entre el 22 y el 26.
--
-- ⛔ POR QUÉ NO SE VEÍA. La app del chofer, al fallar el `insert`, cae a su cola local y
-- dice **«📵 Guardada (se sube al reconectar)»**. O sea que el chofer veía un mensaje de
-- éxito, la surtida quedaba en el teléfono, y nunca subía. Un rechazo de RLS se le
-- presentaba como «no hay internet».
--
-- QUÉ SE HACE. Se devuelve el INSERT, y **solo para `authenticated`**.
--
-- ⛔ NO se abre `anon`, aunque las tres tablas hermanas lo tengan así. Ese `anon` con
-- `USING (true)` es justamente el hallazgo rojo del 28/08 —la operación de Betangar se
-- puede leer y modificar con la llave pública de la página de un colegio— y copiarlo acá
-- sería reabrir a mano el agujero que hay pendiente de cerrar.
--
-- ✅ Y no hace falta: **la app del chofer inicia sesión**. `chofer.html` hace
-- `signInWithPassword` con una cuenta sintética por unidad (`synthEmailUnidad(cam)`) y
-- solo entra a la app con sesión abierta — si no la tiene, muestra la pantalla de clave.
-- O sea que escribe como `authenticated`. **Ésa es la respuesta a la pregunta que quedó
-- abierta anoche**: «medir con qué llave escribe la app del chofer, antes de cerrar
-- `anon`». Escribe con sesión, así que cerrar `anon` en las tablas del chofer NO la deja
-- muda — lo que faltaba saber para poder cerrarlo.
--
-- `NOT app_solo_lectura()` va igual que en las hermanas: respeta el modo de solo lectura.
--
-- Reversa al final.

begin;

create policy surtidas_ins_auth on public.surtidas
  for insert to authenticated
  with check (not app_solo_lectura());

commit;

-- ============================================================================
-- REVERSA:  drop policy surtidas_ins_auth on public.surtidas;
--   (⚠️ pero eso deja otra vez a la flota sin poder cargar combustible)
-- ============================================================================
