-- ════════════════════════════════════════════════════════════════════════════════════════════
--  LA GEOCERCA DEL VERTEDERO, DEDUCIDA DEL RECORRIDO
--  15/08/2026
--
--  POR QUÉ HACÍA FALTA
--  Sin ella, las paradas largas de descarga se cuentan como «parada en ruta» — o sea, como si
--  fueran recolección. El 15/08 la pantalla mostró una parada de 84 min y otra de 29 fuera de
--  toda geocerca: cualquiera de las dos, puesta delante de la Alcaldía como trabajo de
--  recolección, se cae en la primera revisión.
--
--  DE DÓNDE SALEN ESTAS COORDENADAS — es deducción, no un dato que dio nadie
--  El 14/08 quedó anotado un candidato («polígono grande sin calles en el límite Maracaibo /
--  Lossada») con la advertencia de no cargarlo hasta ver el mismo punto repetido varios días.
--  Con dos días de sondeo, el patrón se repite y es inconfundible:
--
--    14/08  18:45  llega a  51 km/h  →  23 min entre 0 y 11 km/h dentro de ~200 m  →  se va
--    15/08  08:04  llega a  78 km/h  →  22 min entre 0 y 12 km/h dentro de ~200 m  →  62 km/h
--
--  Entrar a velocidad de carretera, arrastrarse veinte minutos en un pañuelo y salir a velocidad
--  de carretera **no es una ruta de recolección**: una ruta no llega ni se va así. Es entrar,
--  descargar y salir. La dirección que devuelve el proveedor para esos puntos es
--  «Parroquia Concepción, Municipio Lossada», que es exactamente el candidato del 14.
--
--  Centro y radio calculados sobre los 25 puntos con velocidad ≤ 15 km/h: el más lejano queda a
--  286 m del centro, así que 300 m los cubre a todos.
--
--  ⛔ LO QUE ESTO NO PRUEBA. Que el camión descarga ahí está medido; que ese lugar SE LLAME
--     vertedero municipal, y que sea el que corresponde, no lo dice el GPS: lo dice una persona.
--     Por eso el nombre lleva «SIN CONFIRMAR» y va a verse así en el mapa y en cada parada que
--     caiga adentro. Cuando administración lo confirme —o diga que es otro—, se borra esta fila
--     y se crea la buena. No se puede editar un sitio, solo crear y borrar.
--
--  ⚠️ EL RADIO ES LO QUE MÁS VA A HABER QUE AJUSTAR. 300 m sale de dos visitas. Si el terreno es
--     más grande, van a aparecer descargas contadas como «parada en ruta» justo afuera del borde.
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

insert into public.sitios_asistencia (nombre, lat, lng, radio_m, tipo, es_oficina, activo)
select 'VERTEDERO (deducido del GPS · SIN CONFIRMAR)', 10.63229, -71.78887, 300, 'vertedero', false, true
 where not exists (
   select 1 from public.sitios_asistencia where tipo = 'vertedero'
 );

commit;

-- ── COMPROBACIÓN (correr y MIRAR) ───────────────────────────────────────────────────────────
-- 1) La geocerca existe y es la única de su tipo:
--    select id, nombre, lat, lng, radio_m, tipo from public.sitios_asistencia order by id;
--
-- 2) Y lo que importa: las descargas de los dos días TIENEN que caer adentro. Si no caen, el
--    centro está mal y la geocerca no sirve para nada.
--    with p as (select ts, lat, lon, velocidad from public.gps_posiciones where velocidad <= 15)
--    select (ts at time zone 'America/Caracas')::date dia, count(*) puntos_lentos_dentro
--      from p, public.sitios_asistencia s
--     where s.tipo='vertedero'
--       and sqrt(power((p.lat-s.lat)*111320,2)+power((p.lon-s.lng)*111320*cos(radians(p.lat)),2)) <= s.radio_m
--     group by 1 order by 1;
--    Esperado: los dos días con puntos adentro (14/08 y 15/08).

-- ── PARA BORRARLA, si administración dice que es otro lugar ─────────────────────────────────
-- delete from public.sitios_asistencia where tipo='vertedero' and nombre like '%SIN CONFIRMAR%';
