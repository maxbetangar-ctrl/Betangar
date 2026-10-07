-- ═══════════════════════════════════════════════════════════════════════════════
-- `documentos_cam` Y `documentos_emp` ESTÁN MUERTAS — y se dice, para no volver a medirlas
--
-- ⚠️ ESTA MIGRACIÓN CORRIGE UN REPORTE MÍO DEL MISMO DÍA. Al auditar el rol `compras`
--    conté que estas dos tablas tienen **RLS encendido y CERO policies** y reporté que «ahí
--    no lee NADIE, así que el módulo documentos está vacío para todos los roles».
--    **Era falso.** El módulo funciona perfectamente: no usa estas tablas.
--
-- ✅ DÓNDE VIVEN DE VERDAD LOS DOCUMENTOS, medido el 07/10/2026:
--      · los ARCHIVOS  → bucket PRIVADO de storage `documentos` (enlaces firmados a 1 h)
--      · la FICHA      → `configuracion`, en las filas `clave='docs_cam'` y `clave='docs_emp'`,
--                        como un JSON (lo carga `app.js` en `DOCS_CAM` / `DOCS_EMP`)
--
-- 🔴 LO QUE SÍ ESTÁ MAL ES QUE EXISTAN. Medido en las bases y en los seis repos:
--      · 0 filas en FLOTILLA, Betangar, Tony Gas y VIDECA
--      · 0 referencias en app.js, chofer.html y el resto del código — en los SEIS repos
--      · lo único que las nombra es `maxware-tools/cerrar-anon-2026-09-14/flotamax-demo.sql`
--    Son un SEÑUELO VACÍO al lado del registro real, que es exactamente lo que ya costó
--    caro: medir `unidades` (0 filas) en vez de `unidad_config` (el maestro) hizo decir
--    «Tony Gas: CERO unidades» cuando tiene 26 usándose, y pasó TRES veces.
--    [[norma-un-concepto-un-solo-registro]] · [[norma-control-positivo-antes-de-creerle-al-vacio]]
--
-- ⛔ LO QUE NO SE HACE ACÁ, Y POR QUÉ:
--    1. **No se abre nada.** RLS encendido con cero policies es el estado CORRECTO de una
--       tabla muerta: cerrada. Y `anon` ya no tiene ni un permiso en las dos (comprobado).
--       Abrirlas habría sido ponerle una puerta a un cuarto que no existe.
--    2. **No se DROPEAN.** Es irreversible y lo decide Máximo. Esto deja todo listo para
--       que el día que lo diga sea un `drop` de dos tablas vacías y nada más.
--
-- ✅ LO QUE SÍ SE HACE: quitarles los permisos de ESCRITURA a `authenticated` —tenía los
--    cuatro verbos por el default-acl del esquema, no porque alguien se los diera— para que
--    el señuelo no pueda empezar a llenarse por accidente, y dejar escrito EN LA PROPIA BASE
--    dónde están los datos de verdad. Un comentario en la tabla lo lee el que va a medirla,
--    que es justo el momento en que hace falta.
--    [[norma-toda-tabla-nace-abierta-a-anon-por-default-acl]]
-- ═══════════════════════════════════════════════════════════════════════════════

comment on table public.documentos_cam is 'MUERTA — no la use ni la mida. 0 filas y 0 referencias en el codigo (medido 07/10/2026 en los 6 repos). Los documentos de las unidades viven en: ARCHIVOS = bucket privado de storage `documentos`; FICHA = tabla `configuracion`, fila clave=''docs_cam'' (JSON). Esta tabla es un senuelo vacio al lado del registro real: medir la equivocada ya costo decir «cero unidades» de un cliente que tenia 26. Candidata a DROP, lo decide Maximo.';

comment on table public.documentos_emp is 'MUERTA — no la use ni la mida. 0 filas y 0 referencias en el codigo (medido 07/10/2026 en los 6 repos). Los documentos del personal viven en: ARCHIVOS = bucket privado de storage `documentos`; FICHA = tabla `configuracion`, fila clave=''docs_emp'' (JSON). Candidata a DROP, lo decide Maximo.';

revoke all on public.documentos_cam from anon;
revoke all on public.documentos_emp from anon;
revoke insert, update, delete, truncate, references on public.documentos_cam from authenticated;
revoke insert, update, delete, truncate, references on public.documentos_emp from authenticated;
