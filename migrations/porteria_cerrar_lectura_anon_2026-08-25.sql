-- ═══════════════════════════════════════════════════════════════════════════
--  `porteria`: se le quita a `anon` la LECTURA (y el UPDATE huérfano)
--  Hallazgo ALTA de la auditoría, abierto desde el 23/08/2026.
--
--  QUÉ SE FILTRA HOY
--  `anon` lee 25 filas de `public.porteria`. Con `tipo='asistencia'` eso es el
--  registro de entrada y salida del personal: NOMBRE y HORA de cada persona.
--  La llave `anon` es pública —va dentro de `chofer.html`—, así que esto lo
--  puede leer cualquiera que abra el archivo.
--
--  ⛔ POR QUÉ NO SE TOCA EL INSERT
--  `chofer.html` ESCRIBE en `porteria` (:2289 la cola de incidencias offline,
--  :3386 el reporte en vivo). Quitarle el INSERT deja al chofer sin poder
--  reportar un accidente. Es camino de usuario: no se toca acá.
--
--  ✅ POR QUÉ EL SELECT SÍ ES SEPARABLE — medido, no supuesto
--  `chofer.html` **no lee `porteria` en ninguna línea**: solo `.insert(`, dos
--  veces. Las ocho lecturas están en `app.js` (:22348, :22434, :23270, :23285),
--  que es la oficina, y la oficina abre autenticada (`app.js:893`: la sesión
--  Auth viaja en todas las consultas). `authenticated` conserva sus 4 verbos.
--
--  ➕ Y de paso el UPDATE: `anon` también lo tiene, con su policy
--  `chofer_anon_update`, y **ningún archivo del producto actualiza `porteria`**.
--  Es un permiso huérfano. Se lista en vez de dejarlo callado (norma del 22/08).
--
--  ⚠️ Las policies `chofer_anon_select` y `chofer_anon_update` se quedan donde
--  están: sin el grant no conceden nada, y borrarlas es otra decisión. El
--  candado duro es el `revoke` — una policy suma con OR, un grant que no está
--  no se puede sumar.
--
--  PARA DESHACERLO:  grant select, update on public.porteria to anon;
-- ═══════════════════════════════════════════════════════════════════════════

revoke select, update on public.porteria from anon;

-- Comprobación: `anon` debe quedar solo con INSERT, `authenticated` con los 4.
select g.grantee, string_agg(g.privilege_type, ', ' order by g.privilege_type) as verbos
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.table_name = 'porteria'
   and g.grantee in ('anon','authenticated')
 group by g.grantee order by g.grantee;
