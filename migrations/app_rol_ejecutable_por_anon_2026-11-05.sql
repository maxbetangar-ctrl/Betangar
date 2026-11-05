-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- UNA FUNCIÓN DE POLÍTICA QUE EL ROL DE LA POLÍTICA NO PUEDE EJECUTAR NO DENIEGA: REVIENTA
--
-- ⛔ LO MEDIDO (05/11/2026). Pidiendo `surtidas` como ANÓNIMO, con la clave pública de la app:
--
--      GET /rest/v1/surtidas  →  HTTP 401
--      {"code":"42501","message":"permission denied for function app_rol"}
--
--    Esa tabla tiene su política de lectura declarada para `{public}` —no para
--    `{authenticated}`—, así que PostgreSQL la evalúa también para `anon`. La política llama a
--    `app_rol()`, y `anon` NO tiene EXECUTE sobre ella. Resultado: en vez de "no hay filas
--    para vos", sale un error que (a) dice que es un problema de permisos cuando es de sesión,
--    (b) nombra una función interna a cualquiera que pregunte sin estar logueado.
--
-- ⛔ CUÁNTO ES. Medido en las tres bases el 05/11/2026:
--
--      Principal (Betangar/Geppetto)  hrkjddehqnzcqwlkklqm   22 políticas {public} en 8 tablas
--      FLOTILLA                       mcvizzknpqrggohbohcw   16 políticas {public} en 7 tablas
--      TONY GAS                       zolkkjmbjjroywrvaxpd   15 políticas {public} en 6 tablas
--
--    Más `app_puede_borrar()`, en la misma situación: 3 · 5 · 5 políticas {public}.
--    En las tres bases `app_rol()` está sin EXECUTE para `anon`; `app_puede_borrar()` lo tiene
--    en Principal y FLOTILLA, y NO en Tony Gas — o sea que además las tres están distintas.
--
-- ⛔ ESTO NO ABRE NADA, Y ES IMPORTANTE QUE QUEDE CLARO.
--      app_rol()          = select rol from btg_usuarios where auth_user_id = auth.uid()
--    Devuelve el rol DEL QUE PREGUNTA, leído de su propio token. Para `anon`, `auth.uid()` es
--    NULL ⇒ devuelve NULL ⇒ toda política que la use da FALSO ⇒ CERO FILAS. Que es exactamente
--    lo que tiene que pasar. Hoy, en vez de cero filas, sale un error.
--
--    Dicho al revés: el permiso NO vive en el GRANT de la función, vive en el rol que la
--    función devuelve. El GRANT solo decide si la política puede preguntarlo.
--
-- 📌 LO QUE SÍ HAY QUE SEGUIR CERRANDO son las funciones de NEGOCIO (`surtidas_listar`,
--    `surtida_foto`, y las que vengan): esas siguen solo para `authenticated`. Son dos
--    categorías distintas y conviene no mezclarlas:
--      · función de POLÍTICA  → ejecutable por TODOS los roles que la política alcanza.
--      · función de NEGOCIO   → solo los roles que de verdad pueden usarla.
--
-- CÓMO CORRERLO: una vez por base, en el SQL Editor de Supabase.
--   Principal  hrkjddehqnzcqwlkklqm
--   FLOTILLA   mcvizzknpqrggohbohcw
--   TONY GAS   zolkkjmbjjroywrvaxpd
-- ═══════════════════════════════════════════════════════════════════════════════════════════

grant execute on function public.app_rol() to anon;
grant execute on function public.app_puede_borrar() to anon;

-- ── Comprobación, en la misma corrida ──────────────────────────────────────────────────────
-- Tiene que devolver `anon_puede = true` en las dos filas. Si alguna sale en false, el grant
-- no quedó y NO hay que darlo por bueno.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
       array_to_string(p.proacl, ' | ')                 as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('app_rol', 'app_puede_borrar')
 order by p.proname;

-- Y después, desde afuera y sin sesión, pedir la tabla:
--   curl -s "<url>/rest/v1/surtidas?select=id&limit=1" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
-- Antes:  {"code":"42501","message":"permission denied for function app_rol"}
-- Ahora:  []        ← la denegación correcta: no hay filas, y no se cuenta nada de adentro.
