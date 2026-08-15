-- ════════════════════════════════════════════════════════════════════════════════════════════
--  RÉPLICA A BETANGAR de la migración homónima de `flotilla-app` (15/08/2026).
--  Se comprobó ANTES de copiar que las 4 tablas del chofer son IDÉNTICAS en las dos bases:
--  102 columnas cada una, cero diferencias, y los 4 índices únicos con el mismo nombre.
--  Por eso va sin adaptar. El texto original sigue abajo tal cual.
--  ⚠️ Esta base la comparte GEPPETTO (tablas edu_* / usdt_*): nada de esto las toca.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  SE LE CIERRAN A `anon` LAS 4 TABLAS DEL CHOFER  ·  FLOTILLA
--  15/08/2026
--
--  ⛔ ORDEN OBLIGATORIO. Esto va ÚLTIMO:
--     1. `chofer_escrituras_por_rpc_2026-08-15.sql`   (las 5 RPC)
--     2. desplegar `chofer.html` y `chofer-sw.js`      (que las usen)
--     3. comprobar que producción sirve el archivo nuevo
--     4. este archivo
--  Al revés, la flota queda sin poder registrar viajes, checklist ni mediciones.
--
--  QUÉ CIERRA
--  La llave `anon` está en el JS público: la tiene cualquiera que abra la página. Hasta hoy, con
--  esa llave se leía la operación completa del cliente — cuántos viajes hizo cada unidad, los
--  checklists, el odómetro y las mediciones de combustible. La ESCRITURA ya se había acotado el
--  14/08; esto cierra la lectura, que era lo que quedaba.
--
--  POR QUÉ SE REVOCA TODO Y NO SOLO EL SELECT
--  Porque no se puede solo el SELECT. Medido el 15/08 contra una tabla de descarte:
--    · sin privilegio SELECT, un UPDATE que filtra por columnas devuelve 401 — y TODA
--      actualización tiene que nombrar su fila, así que se rompen todas las escrituras;
--    · y si en vez del permiso se quita la POLÍTICA de SELECT, el UPDATE responde 204 y
--      NO ESCRIBE NADA: `res.error` queda en null, la pantalla dice «guardado» y la flota
--      reporta un día que la base no tiene.
--  La única salida era que la escritura dejara de necesitar la tabla. Por eso primero fueron las
--  RPC `security definer`, y recién ahora se puede revocar el paquete completo.
--
--  QUIÉN SIGUE ENTRANDO
--    · el CHOFER, por las 5 RPC de escritura y las 7 de lectura (no toca ninguna tabla);
--    · la OFICINA (`app.js`), que entra con usuario y clave: usa el rol `authenticated`, que
--      conserva sus permisos intactos. Comprobado: `DB_READY` solo se pone en true después de
--      autenticarse, así que ninguna pantalla consulta antes del login.
--    · los procesos de servidor, con `service_role`.
--
--  REVERSA
--  Está escrita al final. Es una línea por tabla y se aplica en segundos.
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

revoke all on public.viajes_chofer          from anon;
revoke all on public.checklist              from anon;
revoke all on public.km_data                from anon;
revoke all on public.combustible_mediciones from anon;

-- Las políticas quedan sin efecto al no haber permiso, pero se quitan igual: una política viva
-- sobre una tabla cerrada hace creer que `anon` todavía es un camino, y el que la lea mañana va a
-- suponer mal. ([[norma-permiso-que-ninguna-pantalla-muestra]])
drop policy if exists chofer_anon_select on public.viajes_chofer;
drop policy if exists chofer_anon_insert on public.viajes_chofer;
drop policy if exists chofer_anon_update on public.viajes_chofer;

drop policy if exists chofer_anon_select on public.checklist;
drop policy if exists chofer_anon_insert on public.checklist;
drop policy if exists chofer_anon_update on public.checklist;

drop policy if exists chofer_anon_select on public.km_data;
drop policy if exists chofer_anon_insert on public.km_data;
drop policy if exists chofer_anon_update on public.km_data;

drop policy if exists chofer_anon_select on public.combustible_mediciones;
drop policy if exists chofer_anon_insert on public.combustible_mediciones;
drop policy if exists chofer_anon_update on public.combustible_mediciones;

commit;

-- ── COMPROBACIÓN DESDE ADENTRO ──────────────────────────────────────────────────────────────
-- La primera consulta tiene que devolver CERO filas para `anon`. La segunda es el control: si
-- `authenticated` tampoco aparece, la consulta no está mirando lo que creés.
--
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--  where table_schema='public'
--    and table_name in ('viajes_chofer','checklist','km_data','combustible_mediciones')
--    and grantee in ('anon','authenticated') order by 1,2;

-- ── COMPROBACIÓN DESDE AFUERA (lo único que prueba de verdad) ───────────────────────────────
-- ANON=$(curl -s https://flotilla.maxware.app/chofer.html | grep -o "data_key: *'[^']*'" | sed "s/.*'\(.*\)'/\1/")
-- B=https://mcvizzknpqrggohbohcw.supabase.co/rest/v1
--
-- curl -s "$B/viajes_chofer?select=*&limit=1" -H "apikey: $ANON"    # 401 → cerrado
-- curl -s -X POST "$B/rpc/hay_conexion" -H "apikey: $ANON" \
--      -H "Content-Type: application/json" -d '{}'                  # true → el chofer sigue entrando

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  REVERSA — si algo del chofer dejara de funcionar, esto lo devuelve en segundos
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- begin;
--   grant select, insert, update on public.viajes_chofer          to anon;
--   grant select, insert, update on public.checklist              to anon;
--   grant select, insert, update on public.km_data                to anon;
--   grant select, insert, update on public.combustible_mediciones to anon;
--   create policy chofer_anon_select on public.viajes_chofer          for select to anon using (true);
--   create policy chofer_anon_select on public.checklist              for select to anon using (true);
--   create policy chofer_anon_select on public.km_data                for select to anon using (true);
--   create policy chofer_anon_select on public.combustible_mediciones for select to anon using (true);
--   -- ⚠️ Las de INSERT/UPDATE tenían ventana de fecha: NO se reponen con `using(true)`.
--   --    Están en `anon_ventana_2_dias_2026-08-14.sql`, que es de donde hay que copiarlas.
-- commit;
