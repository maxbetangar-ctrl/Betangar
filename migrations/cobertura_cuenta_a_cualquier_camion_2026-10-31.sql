-- ════════════════════════════════════════════════════════════════════════════
--  LA COBERTURA TIENE QUE CONTAR AL CAMIÓN QUE CUBRIÓ AL COMPAÑERO.
--
--  LO QUE PASÓ (31/10/2026). Máximo pidió verificar los PDF por chofer: «recuerda
--  que son 12 camiones y unos van a una zona y otros a otra». Medido:
--    · los 12 fueron a Venancio Pulgar ese día (97-100% de su trabajo ahí): el
--      cronograma estaba bien;
--    · PERO en 3 de las 12 zonas el que más trabajó NO era el asignado. La zona de
--      B011 la hizo B012; B007 se fue a hacer la zona 8, que es de B003, y la suya
--      la cubrieron B004 y B012.
--  ⚠️ CORRECCIÓN A ESTE MISMO COMENTARIO: la primera versión decía «B011 casi no
--     trabajó, 46 posiciones contra 188-337 del resto». Es FALSO y lo escribí sin
--     medirlo: B011 puso 393 posiciones ese día, 241 de ellas trabajando, desde las
--     06:00 — un día completo. Lo que tiene bajo es el trabajo DENTRO de Venancio:
--     45. O sea que no trabajó poco, trabajó AFUERA. «Pocas posiciones en la zona»
--     y «poco trabajo» son cosas distintas y confundirlas acusa al chofer.
--     [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--  O sea: SE CUBRIERON ENTRE ELLOS. Y esta función, que sólo mira al camión
--  asignado, leía eso como «cuatro que no hicieron su zona y dos que completaron»
--  — el reclamo al revés, y silencio para el que trabajó de más.
--
--  ⛔ ERAN DOS PREGUNTAS DISTINTAS EN UN SOLO NÚMERO:
--       ¿quedó la calle sin recoger?  → la contesta CUALQUIER camión
--       ¿quién tenía que hacerla?     → la contesta la asignación
--     Mezcladas, un PDF le dice a un chofer «te quedaron 15 calles sucias» por
--     calles que su compañero ya limpió. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
--  CUÁNTO CAMBIA (medido en Venancio Pulgar, 31/10, 694 tramos):
--       lo hizo el asignado  339
--       lo hizo OTRO camión  132   ← antes se contaban como «sin limpiar»
--       no pasó nadie        223   ← esto es lo único que de verdad quedó pendiente
--     132 de 694 es el 19%: un tercio de lo que la función llamaba «sin limpiar»
--     estaba hecho.
--
--  ⚠️ Y NO SE COLAPSA EN «LIMPIO / SUCIO». Contar a cualquier camión puede mentir
--     para el otro lado: uno que pasa despacio camino al vertedero marcaría la
--     calle como hecha sin haber recogido. Por eso van TRES estados y el que
--     informa los mantiene separados:
--       `hecho`          el camión de la zona pasó por ahí
--       `hecho_alguien`  pasó algún camión — pudo recoger o pudo sólo pasar
--       `hecho_por`      cuál fue el que más posiciones puso en ese tramo
--     «Pasó otro» NO es «está limpio»: es una pregunta para el supervisor.
--     [[norma-falta-de-dato-no-es-un-dato]]
--
--  📌 LO QUE SE PROBÓ Y NO SE HIZO: medir contra CADA SEGMENTO del tramo en vez de
--     contra la cuerda (primer vértice a último). La cuerda es geométricamente
--     peor —1.388 de 1.942 tramos tienen curvas, y en 185 se aleja más de 45 m del
--     recorrido real—, pero medido cambia UN tramo de 694 (339 → 338). No paga.
--     Donde la precisión punto por punto sí importa —contestar una denuncia—
--     `zona_en_punto` y `denuncia_por_calle` YA miden segmento por segmento.
--     [[norma-medir-contra-produccion-es-una-operacion]]
--
--  ⚠️ Se agregan columnas AL FINAL: `ruta-chofer` lee `f.hecho` por nombre y sigue
--     andando sin cambios. Cambiar el tipo de retorno obliga a `drop` —
--     `create or replace` da «cannot change return type» — y el `drop` se lleva los
--     permisos, así que se vuelven a dar abajo.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists zona_cobertura_del_dia(date);

create function zona_cobertura_del_dia(p_fecha date default null)
returns table (
  parroquia text, zona smallint, cam text, asignada_desde date,
  posiciones_del_cam int,
  zona_calle_id bigint, nombre text, tramo text, metros int, orden smallint,
  geom jsonb, hecho boolean,
  -- ── nuevas ────────────────────────────────────────────────────────────────
  hecho_alguien boolean,   -- pasó ALGÚN camión (no necesariamente el de la zona)
  hecho_por text           -- el que más posiciones puso ahí; null si no pasó nadie
)
language sql stable security definer set search_path = public as $fn$
with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
asig as (
  select a.parroquia, a.zona, a.cam, a.desde
    from zona_asignacion a, f
   where a.desde <= f.d and (a.hasta is null or a.hasta >= f.d)),
pos as (
  -- ⛔ El filtro por día va como RANGO, no `(ts at time zone ...)::date = d`: con la
  --    función encima de la columna el índice (cam, ts) no se usa.
  --    [[norma-un-filtro-sobre-la-columna-apaga-el-indice]]
  select g.cam, g.lat, g.lon
    from gps_posiciones g, f
   where g.ts >= (f.d::timestamp at time zone 'America/Caracas')
     and g.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
     and g.velocidad <= 15 and g.ignicion is not false),
cuantas as (
  select cam, count(*)::int n from pos group by 1),
-- ⛔ ACÁ ESTABA EL ERROR: antes este join era `p.cam = a.cam`, o sea sólo el camión
--    asignado. Ahora se cuenta a cualquiera, y QUIÉN fue queda en el resultado.
tocado as (
  select zc.id, p.cam, count(*)::int n
    from zona_calles zc
    join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
    join pos p  on p.lat between zc.la_min - 0.0004 and zc.la_max + 0.0004
                and p.lon between zc.lo_min - 0.0004 and zc.lo_max + 0.0004
   where _dist_a_tramo_m(p.lat, p.lon,
           (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
           (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8) <= 45
   group by zc.id, p.cam),
mejor as (
  -- El que más posiciones puso. `cam` al final del orden para que empates no
  -- devuelvan uno distinto en cada corrida.
  select distinct on (t.id) t.id, t.cam
    from tocado t order by t.id, t.n desc, t.cam)
select zc.parroquia, zc.zona, a.cam, a.desde,
       coalesce(c.n, 0),
       zc.id, zc.nombre, zc.tramo, zc.metros, zc.orden,
       zc.geom,
       (tp.id is not null),
       (m.id is not null),
       m.cam
  from zona_calles zc
  join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
  left join cuantas c on c.cam = a.cam
  left join tocado  tp on tp.id = zc.id and tp.cam = a.cam
  left join mejor   m  on m.id = zc.id
 order by zc.parroquia, zc.zona, zc.orden
$fn$;

comment on function zona_cobertura_del_dia(date) is $c$Tramo por tramo de cada zona asignada: quién pasó ese día. `hecho` = el camión DE ESA ZONA pasó a <=45 m del tramo, a <=15 km/h (recogiendo, no cruzando). ⛔ `hecho_alguien` y `hecho_por` existen porque los choferes SE CUBREN ENTRE ELLOS: el 31/10, 132 de los 694 tramos de Venancio Pulgar los hizo un camión distinto al asignado, y contarlos como «sin limpiar» le reclamaba a un chofer por calles que su compañero ya había hecho. ⚠️ «Pasó otro» NO ES «está limpio»: uno que va despacio camino al vertedero marca el tramo igual. Son tres estados y no se colapsan. ⛔ Y «no pasó nadie» NO es «no se recogió»: el equipo se calla hasta 57 min andando, por eso va `posiciones_del_cam` — sin ese número un GPS mudo se lee igual que un chofer que no trabajó. ⛔ `asignada_desde` está para que nadie arme un reclamo con un día anterior a que esa zona fuera de ese camión.$c$;

revoke all on function zona_cobertura_del_dia(date) from anon, public;
grant execute on function zona_cobertura_del_dia(date) to authenticated;
grant execute on function zona_cobertura_del_dia(date) to service_role;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- ⛔ CONTROL POSITIVO ADENTRO. Lo primero que se verifica es que `hecho` NO cambió:
--    si el arreglo moviera ese número, estaría tocando lo que ya andaba bien.
-- ⛔ NO SE CLAVAN LOS NÚMEROS DE HOY. El primer intento exigía «132 tramos hechos por
--    otro camión» y la migración se abortó sola: dio 133. No había error — el día NO
--    TERMINÓ y entre la medición y el `apply` entró una posición más. Una prueba atada
--    a un número de un día en curso se rompe sin que nada esté mal, y la próxima vez
--    que falle nadie va a saber si es un bug o el reloj.
--    Se comprueba la LÓGICA: la vieja se recalcula acá al lado, sobre los mismos datos
--    de la misma corrida, y tiene que dar igual. Eso sí es una regresión de verdad.
--    [[norma-una-medicion-tiene-hora]]
do $v$
declare
  v_tot int; v_asig int; v_otro int; v_nadie int; v_cols int;
  v_viejo int; v_dia date := '2026-10-31';
begin
  select count(*), count(*) filter (where hecho),
         count(*) filter (where not hecho and hecho_alguien),
         count(*) filter (where not hecho_alguien)
    into v_tot, v_asig, v_otro, v_nadie
    from zona_cobertura_del_dia(v_dia)
   where parroquia = 'Parroquia Venancio Pulgar';

  if v_tot <> 694 then
    raise exception 'Venancio tiene 694 tramos en zona_calles y la función devolvió %', v_tot;
  end if;

  -- CONTROL POSITIVO / REGRESIÓN: la regla vieja —cuerda y SÓLO el camión asignado—
  -- recalculada sobre los mismos datos. `hecho` tiene que coincidir exactamente.
  with f as (select v_dia d),
  asig as (
    select a.parroquia, a.zona, a.cam from zona_asignacion a, f
     where a.desde <= f.d and (a.hasta is null or a.hasta >= f.d)
       and a.parroquia = 'Parroquia Venancio Pulgar'),
  pos as (
    select g.cam, g.lat, g.lon from gps_posiciones g, f
     where g.ts >= (f.d::timestamp at time zone 'America/Caracas')
       and g.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
       and g.velocidad <= 15 and g.ignicion is not false)
  select count(distinct zc.id) into v_viejo
    from zona_calles zc
    join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
    join pos p  on p.cam = a.cam
                and p.lat between zc.la_min - 0.0004 and zc.la_max + 0.0004
                and p.lon between zc.lo_min - 0.0004 and zc.lo_max + 0.0004
   where _dist_a_tramo_m(p.lat, p.lon,
           (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
           (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8) <= 45;

  if v_asig <> v_viejo then
    raise exception 'REGRESION: «lo hizo el asignado» da % y la regla vieja da %',
      v_asig, v_viejo;
  end if;

  -- El fenómeno tiene que EXISTIR: si diera 0, el arreglo no estaría haciendo nada.
  if v_otro = 0 then
    raise exception 'ningún tramo aparece hecho por otro camión: el arreglo no hace efecto';
  end if;

  if v_asig + v_otro + v_nadie <> v_tot then
    raise exception 'los tres estados no suman el total: % + % + % <> %',
      v_asig, v_otro, v_nadie, v_tot;
  end if;

  -- ⛔ Y que `hecho_por` sea coherente: donde pasó alguien, tiene que decir quién;
  --    donde no pasó nadie, tiene que estar vacío. Un campo que se llena a medias
  --    se lee como un dato y no lo es.
  select count(*) into v_cols from zona_cobertura_del_dia(v_dia)
   where (hecho_alguien and hecho_por is null)
      or (not hecho_alguien and hecho_por is not null);
  if v_cols <> 0 then
    raise exception '% tramos con hecho_alguien y hecho_por en desacuerdo', v_cols;
  end if;

  -- Y que donde lo hizo el asignado, `hecho_alguien` también sea cierto.
  select count(*) into v_cols from zona_cobertura_del_dia(v_dia)
   where hecho and not hecho_alguien;
  if v_cols <> 0 then
    raise exception '% tramos marcados hechos por el asignado pero no por nadie', v_cols;
  end if;

  raise notice 'OK · Venancio 31/10: asignado %, otro camion %, nadie % (total %)',
    v_asig, v_otro, v_nadie, v_tot;
end $v$;
