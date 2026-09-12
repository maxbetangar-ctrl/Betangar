-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- EL LADO DEL AYUDANTE — que en el fichaje diga en qué unidad va
-- 2026-09-11 · Betangar · complementa `cuadrilla_del_dia_2026-09-11.sql`
--
-- Máximo: *«en la fichada los ayudantes que coloquen en qué unidad van ese día, tanto los
-- internos como los del IMAU»*.
--
-- 📌 NO HACE FALTA NINGUNA FUNCIÓN NUEVA PARA GUARDARLO: `fichar_asistencia` YA acepta
--    `p_unidad` y `asistencia_dia` YA tiene la columna `unidad`. Estaban ahí desde el
--    29/08 y `fichar.html` mandaba `p_unidad: null` clavado — **1.833 filas, 0 con unidad**.
--    Lo único que faltaba era el picaporte. [[norma-bitacora-nombrar-la-pieza-que-ya-existe]]
--
-- Acá van las dos piezas que sí faltaban, las dos de LECTURA:
--   1. `unidades_activas()` — para poder ofrecer la lista sin hornearla en el HTML otra vez.
--      `unidad_config` está cerrada a `anon` y `unidad_publica` pide un cam que ya se sepa.
--   2. `cuadrilla_de_persona(p_id)` — en qué unidad(es) lo anotó un chofer hoy, para que el
--      ayudante CONFIRME en vez de elegir en blanco. Que las dos declaraciones coincidan
--      cuando son correctas es lo que hace que la que NO coincide signifique algo.
--
-- ⚠️ `cuadrilla_de_persona` NO pide clave, igual que `cuadrilla_del_dia`. Devuelve el código
--    del camión en el que un tercero ya anotó a esa persona hoy; no expone cédula, ni
--    teléfono, ni sueldo, ni el fichaje. Es lo mismo que se ve mirando quién se sube al camión.
--
-- REVERSA: `drop function unidades_activas(); drop function cuadrilla_de_persona(text);`
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.unidades_activas()
returns table(cam text, placa text)
language sql
security definer
set search_path = public, extensions
as $$
  select u.cam, u.placa
    from public.unidad_config u
   where coalesce(u.activo, true) = true
   order by u.cam;
$$;

revoke all on function public.unidades_activas() from public;
grant execute on function public.unidades_activas() to anon, authenticated;

create or replace function public.cuadrilla_de_persona(p_id text)
returns table(cam text, rol text, declarado_por text)
language sql
security definer
set search_path = public, extensions
as $$
  select c.cam, c.rol, c.declarado_por
    from public.cuadrilla_dia c
   where c.empleado_id = p_id
     and c.fecha = (now() at time zone 'America/Caracas')::date
   order by c.creado desc;
$$;

revoke all on function public.cuadrilla_de_persona(text) from public;
grant execute on function public.cuadrilla_de_persona(text) to anon, authenticated;
