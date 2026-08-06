-- BETANGAR — El roster del Excel estaba corrido una fila: 40 planillas quedaron a nombre
-- de quien no era. Se repone lo que dice el Excel, que es la fuente.
-- CORRIDO EN PRODUCCIÓN el 2026-08-06 (hrkjddehqnzcqwlkklqm), autorizado por Máximo.
--
-- ── LA CAUSA (no era la planilla, era la LISTA MAESTRA) ─────────────────────────────────────
-- La hoja PARAMETROS trae el roster de ayudantes en dos columnas paralelas: AF = nombre corto,
-- AL = nombre completo. Alguien insertó `ALEXANDER HERNANDEZ` en la fila 34 SOLO en AF, y de ahí
-- hacia abajo las dos columnas quedaron corridas una fila entre sí:
--
--     AF34 ALEXANDER HERNANDEZ      ↔  AL34 ALEXANDER ARTURO PAZ GONZALEZ
--     AF35 ALEXANDER PAZ            ↔  AL35 CARLOS ALFREDO MONTIEL VILLALOBOS
--     AF36 CARLOS ALFREDO  MONTIEL  ↔  AL36 (vacío)
--
-- Como el importador expande el nombre corto de la planilla con ese mapa, TODA planilla que
-- decía "ALEXANDER PAZ" se guardó como "CARLOS ALFREDO MONTIEL VILLALOBOS". Y las de Montiel
-- cayeron al `|| corto` (AL vacío) y se quedaron con la grafía de dos espacios — que es
-- exactamente de donde nació la ficha duplicada E342 sin cédula.
--
-- ⛔ LA HOJA `REGISTRO VIAJES` NUNCA ESTUVO MAL. Se cotejaron las 1.297 filas del Excel contra
--    las 1.297 de la base, casando por CORRELATIVO de planilla (no por fecha+camión: hay días
--    con dos planillas del mismo camión y esa llave las mezcla). Resultado: chofer 0 diferencias,
--    viajes 0 diferencias, ayudantes 40 — todas de esta misma causa.
--
-- ── POR QUÉ ESTO NO ES LO MISMO QUE LA MIGRACIÓN DEL 05/08 ──────────────────────────────────
-- La del 05/08 dedujo a mano de quién era cada planilla del B008 y NO tocó las de otras unidades
-- ("no se sabe la unidad"). Sobraba el razonamiento: el Excel ya lo decía. Por eso acá SÍ entran
-- la 1101 (B009, 11/07) y la 1105 (B005, 12/07) — RRHH confirmó el 06/08 que los ayudantes ROTAN
-- de unidad, así que Paz en el B009 un día no tiene nada de raro.
-- Y sobre todo: **la del 05/08 nunca llegó a la base**. Se comprobó antes de escribir esta:
-- 0 planillas nombraban a Paz, E342 seguía activa y las 15 grafías cortas seguían ahí.
--
-- ⚠️ SU RESPALDO NO SIRVE, Y PARECÍA QUE SÍ. `backup_montiel_2026-08-05` se armó con
--    `to_jsonb(p) ... from planillas p`: `planillas` TIENE una columna llamada `p` (el
--    correlativo), así que Postgres resolvió la COLUMNA y no la fila. Guardó 111 cadenas
--    ("01201", "01203"…) en vez de 111 filas. Devolvió un JSON válido con 111 elementos y nadie
--    lo miró dos veces. Acá el alias es `pl` justamente por eso.
--
-- ⛔ NO se toca `nomina_historial`: las semanas ya pagadas mantienen su monto (los Bs están
--    congelados a la tasa del día y re-guardar avanza cuotas de préstamos y multas). Lo único
--    que cambia es a quién se le atribuyen los viajes.

-- ── RESPALDO (fila completa, alias distinto de toda columna) ────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_roster_2026-08-06',
       (select jsonb_agg(to_jsonb(pl))::text
          from public.planillas pl
         where pl.id in (4302,4318,4321,4326,4334,4338,4348,4361,4365,4370,4416,4423,4424,4426,
                         4432,4436,4453,4456,5635,5640,5649,5651,5660,5661,5672,5683,5685,5695,
                         5696,5701,6213,6222,6226,6230,6231,6239,6243,6249,6253,6261))
on conflict (clave) do update set valor = excluded.valor;

-- Comprobación del respaldo ANTES de tocar nada: tiene que traer 40 filas CON columnas.
do $$
declare n int; tiene_cam boolean;
begin
  select jsonb_array_length(valor::jsonb),
         (valor::jsonb -> 0 ? 'cam')
    into n, tiene_cam
    from public.configuracion where clave = 'backup_roster_2026-08-06';
  if n <> 40 or not tiene_cam then
    raise exception 'Respaldo inservible (filas=%, trae columnas=%). No se sigue.', n, tiene_cam;
  end if;
end $$;

-- ── PASO 1 — lo que el Excel dice ALEXANDER PAZ (24 planillas) ──────────────────────────────
update public.planillas set ay2 = 'ALEXANDER ARTURO PAZ GONZALEZ'
 where id in (4302,4318,4321,4326,4348,4361,4416,4424,4432,4436,4453,5635,5649,5661,5672,5683,
              5696,6222,6231,6239,6249)
   and ay2 = 'CARLOS ALFREDO MONTIEL VILLALOBOS';

update public.planillas set ay1 = 'ALEXANDER ARTURO PAZ GONZALEZ'
 where id in (4334,4338,4370)
   and ay1 = 'CARLOS ALFREDO MONTIEL VILLALOBOS';

-- ── PASO 2 — la grafía corta de Montiel pasa al nombre completo (16 planillas) ──────────────
-- Acotado por id (no por patrón): así el arreglo dice exactamente qué filas toca.
update public.planillas set ay2 = 'CARLOS ALFREDO MONTIEL VILLALOBOS'
 where id in (4456,5640,5651,5660,5685,5695,6213,6226,6230,6243,6253,6261)
   and ay2 = 'CARLOS ALFREDO  MONTIEL';

update public.planillas set ay1 = 'CARLOS ALFREDO MONTIEL VILLALOBOS'
 where id in (4365,4423,4426,5701)
   and ay1 = 'CARLOS ALFREDO  MONTIEL';

-- ── PASO 3 — una sola ficha de Montiel ──────────────────────────────────────────────────────
-- E706 CARLOS ALFREDO MONTIEL VILLALOBOS — C.I. V-19307663 → SE QUEDA
-- E342 CARLOS ALFREDO  MONTIEL           — SIN cédula      → SE DESACTIVA
-- E342 no la creó RRHH: la creó este mismo bug (AL vacío → `completo = corto` → ficha nueva).
-- Se desactiva, no se borra: quedó nombrada en nóminas ya guardadas.
update public.empleados set activo = false where id = 'E342';

-- ── DESHACER ────────────────────────────────────────────────────────────────────────────────
--   update public.planillas pl
--      set ay1 = b.ay1, ay2 = b.ay2, ay3 = b.ay3
--     from (select (jsonb_array_elements(valor::jsonb)) j from public.configuracion
--            where clave = 'backup_roster_2026-08-06') s,
--          lateral (select (s.j->>'id')::bigint id, s.j->>'ay1' ay1, s.j->>'ay2' ay2,
--                          s.j->>'ay3' ay3) b
--    where pl.id = b.id;
--   update public.empleados set activo = true where id = 'E342';
