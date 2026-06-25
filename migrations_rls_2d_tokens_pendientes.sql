-- FASE 2d — FIX del sistema de TOKENS (autorización de acciones sensibles).
--
-- PROBLEMA (confirmado en vivo 2026-06-25):
--   `tokens_pendientes` quedó FUERA de migrations_rls_authenticated.sql. Tras migrar el
--   login a Supabase Auth, los usuarios entran como rol 'authenticated', pero esta tabla
--   solo tenía política RLS para 'anon'. Medición REST:
--     - anon          → 21 filas (política vieja)
--     - authenticated →  0 filas  (sin política permisiva)
--   Efecto: el solicitante logueado NO puede INSERTAR su token (RLS WITH CHECK lo rechaza)
--   y el superadmin ve [] en el panel → "no llega el token, no aparece en la app, no hay
--   posibilidad de aprobar".
--
-- SOLUCIÓN: darle a 'authenticated' la MISMA política permisiva que el resto de tablas de
--   Betangar (mono-empresa: todo el staff logueado ve/gestiona los tokens). Igual a la
--   política `btg_auth_all` que crea migrations_rls_authenticated.sql en las demás tablas.
--
-- REVERSIBLE: DROP POLICY btg_auth_all ON public.tokens_pendientes;
DROP POLICY IF EXISTS btg_auth_all ON public.tokens_pendientes;
CREATE POLICY btg_auth_all ON public.tokens_pendientes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- NOTA DE SEGURIDAD (pendiente, NO incluida aquí a propósito):
--   Los tokens autorizan acciones sobre dinero y la anon key es pública (visible en el HTML),
--   así que hoy cualquiera podría LEER los códigos pendientes con anon. Lo ideal es revocar
--   anon de esta tabla (igual que la fase 2c con el resto de sensibles):
--       REVOKE ALL ON public.tokens_pendientes FROM anon;
--   PERO antes hay que garantizar que `_tokRestHdr()` SIEMPRE mande el JWT de sesión y nunca
--   caiga al anon key como fallback (app.js:6200 hace `Authorization: Bearer (_SESSION_JWT||SUPA_KEY)`).
--   Si se revoca anon sin ese ajuste, un insert hecho antes de que cargue la sesión se rompería.
--   → Tratar como paso 2d-bis después de blindar el header.
