-- ════════════════════════════════════════════════════════════════════════════
-- `unidad_publica` y `marca_publica`: CERRARLES `PUBLIC` — y de paso el hueco
-- inverso, que es peor.
--
-- 🔴 POR QUÉ. Toda función nace ejecutable por `PUBLIC`: el `grant ... to anon,
--    authenticated` que llevan esas dos NO cierra nada, solo agrega. Quedaron
--    ejecutables por **cualquier rol presente y futuro**, incluido el que se
--    cree mañana. Es la misma falla que se arregló el 14/09 al escribir
--    `sitio_publico`, que sí lleva su `revoke`.
--    [[norma-toda-funcion-nace-abierta-a-public]]
--
--    Medido el 15/09 con `has_function_privilege('public', …)`, base por base:
--      Betangar ............ las DOS abiertas a PUBLIC
--      FLOTILLA · VIDECA · demo  `unidad_publica` abierta a PUBLIC
--      TONY GAS ............ las dos ya estaban bien
--
-- ⛔ Y AL REVÉS, EL HUECO QUE IMPORTA MÁS: en **MOLDE-FLOTAMAX**
--    `unidad_publica` **NO está concedida a `anon`** — solo a `authenticated`.
--    La llama `chofer.html`, que entra por QR y **sin login**, para resolver una
--    unidad que no está en la lista horneada. O sea que **un cliente nuevo nacía
--    con esa parte muerta**, y en silencio: la unidad simplemente «no existe».
--    Es exactamente lo que ya pasó el 03/09 con `fichar_asistencia` y
--    `empleados_publicos`, y por lo mismo: para una auditoría que busca lo que
--    SOBRA, «cerrado» siempre parece la respuesta buena.
--
-- ⛔⛔ `marca_publica` TAMBIÉN VA A `anon`, Y ESTO SE APRENDIÓ ROMPIÉNDOLO.
--    La primera versión de este archivo se la concedía solo a `authenticated`,
--    razonando que la llama `app.js` y que `app.js` lo carga `app.html`, que
--    tiene login. **Falso.** El propio `app.js` lo dice dos líneas arriba de la
--    llamada: *«Antes del login: el logo y el nombre salen en la pantalla de
--    entrada»*. La hidrata `anon`, en la pantalla de acceso.
--    Y en Betangar el acceso de `anon` venía HEREDADO de `PUBLIC`, no de un
--    grant propio: el `revoke` de arriba se lo llevó puesto y dejó la pantalla
--    de login sin logo ni nombre. Se detectó al comprobar, y se repuso con
--    grant PROPIO — que además es lo correcto: un permiso que se hereda de
--    PUBLIC se pierde el día que alguien cierra PUBLIC, sin que nadie lo relacione.
--
-- ⚠️ Es la tercera vez en dos días que el mismo error: mirar si la pieza EXISTE
--    (hay login en el archivo) en vez de CUÁNDO se usa (antes o después de él).
--    [[norma-la-pieza-dice-lo-que-no-hace]]
--
-- Idempotente. Reversa al final.
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function public.unidad_publica(text) from public;
revoke execute on function public.marca_publica()      from public;

grant  execute on function public.unidad_publica(text) to anon, authenticated;
grant  execute on function public.marca_publica()      to anon, authenticated;

-- COMPROBAR (correr DESPUÉS): `public` tiene que dar false y `anon` true en
-- unidad_publica.
--   select proname,
--          has_function_privilege('public', oid, 'EXECUTE') as publico,
--          has_function_privilege('anon',   oid, 'EXECUTE') as anon
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and proname in ('unidad_publica','marca_publica');

-- ============================================================================
-- REVERSA: grant execute on function public.unidad_publica(text) to public;
--          grant execute on function public.marca_publica()      to public;
-- ============================================================================
