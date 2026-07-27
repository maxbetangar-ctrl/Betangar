-- ═════════════════════════════════════════════════════════════════════════════
--  LA LLAVE DE GEMINI DEJA DE PODER LEERSE                       2026-07-27
--
--  `cfg_sel` escondía UNA sola clave:
--
--      cfg_sel   SELECT   using (clave <> 'wassenger')
--
--  O sea que `gemini_api_key` la podía leer **cualquiera con sesión**, choferes
--  incluidos — y no por descuido del RLS, sino porque el análisis de combustible
--  la leía desde el NAVEGADOR para llamar a Gemini. Una llave que baja al
--  teléfono de alguien ya no es una llave: se copia en dos clics.
--
--  Hoy está VACÍA, así que no hubo fuga. Esto es para que no la haya el día que
--  se cargue.
--
--  ── LO QUE CAMBIA, Y LO QUE NO ──────────────────────────────────────────────
--  · La llamada a Gemini se mudó a la Edge Function `gemini`, que lee la llave
--    con la llave de servicio y además comprueba el rol.
--  · La llave SIGUE configurándose desde Configuración → ⛽ Combustible:
--    escribirla ya estaba restringida a superadmin/auditor/admin por `cfg_upd` +
--    `cfg_clave_sensible`. Lo único que se pierde es poder LEERLA de vuelta, que
--    es justo como debe tratarse un secreto: se pone, no se recupera.
--  · El ✓ de «API key configurada» ahora se lo pregunta a la función, que
--    responde sí o no sin devolver nada.
--
--  ⚠️ POR QUÉ NO SE USA `cfg_clave_sensible()` AQUÍ, que sería lo elegante:
--  esa lista incluye `general`, `whatsapp`, `tasa_bnc`… que la aplicación LEE
--  desde el navegador en decenas de sitios (tarifas, km, tanques). Usarla para
--  el SELECT dejaría Betangar sin funcionar. Son dos preguntas distintas:
--  «¿quién puede CAMBIAR esto?» y «¿esto es un SECRETO?». La segunda lista es
--  mucho más corta.
-- ═════════════════════════════════════════════════════════════════════════════

-- Las claves cuyo VALOR es una credencial. Nada más entra acá: cada añadido le
-- quita al navegador algo que quizá esté leyendo.
create or replace function cfg_clave_secreta(p_clave text)
returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_clave in ('wassenger', 'gemini_api_key')
$$;

comment on function cfg_clave_secreta(text) is
  'Claves de `configuracion` cuyo VALOR es una credencial: no se leen desde el navegador. Es distinta de cfg_clave_sensible(), que dice quién puede ESCRIBIR.';

drop policy cfg_sel on configuracion;
create policy cfg_sel on configuracion for select
  using (not cfg_clave_secreta(clave));
