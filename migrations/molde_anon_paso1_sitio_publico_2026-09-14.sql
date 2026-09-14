-- ════════════════════════════════════════════════════════════════════════════
-- MOLDE · PASO 1 de 2 — el RPC que le deja a `fichar.html` seguir mostrando la
-- sucursal del QR SIN tener la tabla abierta a `anon`.
--
-- 🔴 POR QUÉ. El 14/09/2026 se midió con la llave pública de las 5 bases (la
--    `anon`, que es pública POR DISEÑO: viaja en el navegador de cualquiera que
--    abra la app, esté el repo público o privado). Cuatro tablas estaban
--    abiertas a `anon` EN LOS CINCO CLONES — y que estén en los cinco quiere
--    decir que no son el descuido de uno: **vienen del molde**, y el próximo
--    clon las hereda. [[norma-molde-se-regenera-no-se-mantiene]]
--
--    De las cuatro, TRES son restos puros: ninguna página anónima las toca.
--    `asistencia` la escribe el RPC `fichar_asistencia`; `porteria` y
--    `cola_mensajes` solo las toca `chofer.html`, que entra con
--    `signInWithPassword`. Esas se cierran en el paso 2 sin más.
--
--    ⛔ LA ÚNICA DE VERDAD ES `sitios_asistencia`: `fichar.html` la lee SIN
--    login para poner el nombre de la sucursal cuando el QR es por sucursal
--    (`fichar.html?sitio=ID`). Revocarla a secas no rompe el fichaje —el
--    `try/catch` se traga el error— pero **lo degrada en silencio**: se pierde
--    el cartel de la sucursal, `SITIO_FIJO` queda nulo y el fichaje pasa a
--    guardarse como `fichaje` en vez de `fichaje_qr`, o sea que se pierde la
--    prueba de presencia. Un candado que degrada sin avisar es peor que el
--    agujero. [[norma-la-puerta-que-no-existe]]
--
-- ⚠️ ESTE PASO ES ADITIVO Y VA SOLO. Primero el CÓDIGO, después el DATO: este
--    RPC se crea y se despliega `fichar.html` ANTES de revocar nada. Si se
--    revoca primero, hay una ventana en la que el QR de sucursal no funciona.
--    [[norma-primero-el-codigo-despues-el-dato]]
--
-- Devuelve DOS campos de UN sitio, por su id: hay que saber el id exacto y no
-- salen ni lat/lng, ni radio, ni el polígono de la geocerca. Los sitios
-- inactivos no se devuelven.
--
-- `p_id` va como TEXT a propósito: el id viene de la barra de direcciones y
-- puede traer cualquier cosa. Con `bigint` un QR mal pegado devuelve un 400
-- —que la pantalla leería como una falla— en vez de «no hay tal sitio».
-- [[norma-valor-saneado-a-la-fuerza]]
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sitio_publico(p_id text)
returns table(id bigint, nombre text)
language sql security definer set search_path = public stable as $$
  select s.id, s.nombre
    from sitios_asistencia s
   where p_id ~ '^[0-9]+$'
     and s.id = p_id::bigint
     and s.activo is not false
   limit 1;
$$;

-- ⛔ TODA FUNCIÓN NACE ABIERTA A PUBLIC: el `grant` de abajo no cierra nada, hay
--    que REVOCAR primero. `unidad_publica` y `marca_publica`, que son el molde
--    de esta, tienen el grant y NO tienen el revoke: quedaron ejecutables por
--    cualquier rol presente y futuro. [[norma-toda-funcion-nace-abierta-a-public]]
revoke execute on function public.sitio_publico(text) from public;
grant  execute on function public.sitio_publico(text) to anon, authenticated;

-- VERIFICAR: con un id que exista tiene que devolver la fila; con basura, nada
-- y SIN error.
--   select * from public.sitio_publico('1');
--   select * from public.sitio_publico('no-soy-un-id');   -- 0 filas, sin error
