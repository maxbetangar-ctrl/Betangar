-- FlotaMax - Entregas: CANDADO (cierra el hueco crítico #1 de la auditoría 2026-07-06).
-- =====================================================================================
-- Quita el acceso DIRECTO de la anon key pública a la tabla 'entregas'. A partir de aquí
-- anon solo la toca a través de las RPCs de add_entregas_rpc.sql (por token, columnas
-- seguras). La oficina (Supabase Auth = authenticated) conserva acceso total por la
-- policy entregas_auth_all.
--
-- ⚠️ CORRER SOLO DESPUÉS de:
--   1) haber corrido add_entregas_rpc.sql, y
--   2) haber desplegado chofer.html + recibir.html que ya usan las RPCs (betangar.com),
--   3) verificado en vivo que registrar/ver/confirmar/lista del día funcionan.
--   Si se corre antes, el cliente viejo (que hace select/insert/update directo) se rompe.
--
-- REVERSIBLE (rollback de emergencia):
--   create policy entregas_anon_all on entregas for all to anon using (true) with check (true);
--   grant all on public.entregas to anon;
--   create policy entregas_foto_read on storage.objects for select to anon using (bucket_id='entregas');
--
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm). Idempotente.

-- 1) Cerrar el acceso directo de anon a la tabla (fin del volcado/manipulación masiva de PII).
drop policy if exists entregas_anon_all on entregas;
revoke all on public.entregas from anon;

-- 2) Cerrar la ENUMERACIÓN de fotos por la API de storage. El bucket sigue sirviendo cada
--    foto por su URL directa (que recibir.html/oficina necesitan), pero anon ya no puede
--    LISTAR los objetos del bucket.
drop policy if exists entregas_foto_read on storage.objects;

-- NOTA (hallazgo #4, alto — pendiente fase 2): el bucket 'entregas' sigue public=true y las
-- rutas son 'cam/id.jpg' con id adivinable (cam+timestamp), así que una foto concreta aún
-- podría alcanzarse adivinando su URL. Cerrarlo del todo exige bucket privado + signed URLs
-- (cambiar foto_url a URLs firmadas en recibir.html/chofer.html/app.js). Se hará aparte para
-- no romper las fotos ya guardadas como URL pública.

-- Se CONSERVA a propósito:
--   - entregas_foto_insert (anon): el chofer sube la foto con anon; un objeto suelto sin
--     su fila en la tabla no expone PII.
--   - entregas_auth_all (authenticated): la oficina logueada sigue viendo/editando todo.
