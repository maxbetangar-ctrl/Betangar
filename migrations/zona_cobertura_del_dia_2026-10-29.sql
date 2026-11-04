-- ════════════════════════════════════════════════════════════════════════════
--  LO QUE CADA CAMIÓN HIZO DE SU ZONA, TRAMO POR TRAMO.
--
--  PEDIDO (Máximo, 29/10/2026): «quiero ver completo esa impresión de cada ruta
--  parroquia o ruta mía ... para yo poderle mostrar a los choferes qué están
--  haciendo mal».
--
--  ⛔ ESTO NO SE PUEDE MOSTRAR COMO UNA FALTA TODAVÍA, Y LA PIEZA LO DICE. Las
--     zonas se asignaron el 29/10 a las 12:32 y a los choferes no se les dijo
--     nada. Un camión que hoy da 0% de su zona NO la incumplió: trabajó donde
--     venía trabajando. Medido el mismo día: los tres que dan 0% hicieron 130,
--     139 y 149 km con 350-400 posiciones recogiendo. **Trabajaron el día
--     completo.** Por eso la función devuelve `asignada_desde`: quien arme un
--     reclamo tiene que poder ver si el día que mide es anterior a que esa zona
--     fuera suya. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
--  QUÉ CUENTA COMO HECHO: una posición DE ESE CAMIÓN, ese día, a 15 km/h o
--  menos y con el motor encendido, a 45 m o menos del tramo. La velocidad es
--  lo que separa recoger de pasar; sin ese filtro, cruzar una avenida marcaría
--  la cuadra entera como recogida.
--
--  ⛔ Y «NO HECHO» NO ES «NO PASÓ». El equipo se calla hasta 57 minutos con el
--     camión andando: un tramo puede estar recogido y no tener ni una posición.
--     Por eso se devuelve también cuántas posiciones puso ese camión ese día —
--     sin eso, un GPS mudo se lee igual que un chofer que no trabajó.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function zona_cobertura_del_dia(p_fecha date default null)
returns table (
  parroquia text, zona smallint, cam text, asignada_desde date,
  posiciones_del_cam int,
  zona_calle_id bigint, nombre text, tramo text, metros int, orden smallint,
  geom jsonb, hecho boolean
)
language sql stable security definer set search_path = public as $fn$
with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
asig as (
  select a.parroquia, a.zona, a.cam, a.desde
    from zona_asignacion a, f
   where a.desde <= f.d and (a.hasta is null or a.hasta >= f.d)),
pos as (
  select g.cam, g.lat, g.lon
    from gps_posiciones g, f
   where (g.ts at time zone 'America/Caracas')::date = f.d
     and g.velocidad <= 15 and g.ignicion is not false),
cuantas as (
  select cam, count(*)::int n from pos group by 1),
tocado as (
  select distinct zc.id
    from zona_calles zc
    join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
    join pos p  on p.cam = a.cam
                and p.lat between zc.la_min - 0.0004 and zc.la_max + 0.0004
                and p.lon between zc.lo_min - 0.0004 and zc.lo_max + 0.0004
   where _dist_a_tramo_m(p.lat, p.lon,
           (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
           (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8) <= 45)
select zc.parroquia, zc.zona, a.cam, a.desde,
       coalesce(c.n, 0),
       zc.id, zc.nombre, zc.tramo, zc.metros, zc.orden,
       zc.geom, (t.id is not null)
  from zona_calles zc
  join asig a on a.parroquia = zc.parroquia and a.zona = zc.zona
  left join cuantas c on c.cam = a.cam
  left join tocado  t on t.id = zc.id
 order by zc.parroquia, zc.zona, zc.orden
$fn$;

comment on function zona_cobertura_del_dia(date) is $c$Tramo por tramo, qué hizo cada camión de SU zona ese día. Hecho = una posición de ESE camión, ese día, a <=15 km/h (recogiendo, no cruzando) y a <=45 m del tramo. ⛔ `asignada_desde` está para que nadie arme un reclamo con un día anterior a que esa zona fuera de ese camión: las zonas se asignaron el 29/10 12:32 y a los choferes no se les había dicho. ⛔ Y «no hecho» NO es «no pasó»: el equipo se calla hasta 57 min andando, por eso va también `posiciones_del_cam` — sin ese número, un GPS mudo se lee igual que un chofer que no trabajó.$c$;

revoke all on function zona_cobertura_del_dia(date) from anon, public;
grant execute on function zona_cobertura_del_dia(date) to authenticated;

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare n int; z int; cams int; ceros int; mudos int;
begin
  select count(*), count(distinct (parroquia, zona)), count(distinct cam)
    into n, z, cams from zona_cobertura_del_dia('2026-10-29');
  if n = 0 then raise exception 'CONTROL MUDO: la función no devolvió ni un tramo.'; end if;

  -- ⛔ Tiene que devolver TODOS los tramos de las zonas asignadas, hechos y no
  --    hechos. Si sólo devolviera los hechos, «lo que falta» seria invisible —
  --    que es justo lo único que esto viene a mostrar.
  if n <> (select count(*) from zona_calles zc
            join zona_asignacion a on a.parroquia=zc.parroquia and a.zona=zc.zona
           where a.hasta is null) then
    raise exception 'CONTROL FALLIDO: devolvió % tramos y las zonas asignadas tienen otra cantidad.', n;
  end if;

  select count(*) into ceros from (
    select cam from zona_cobertura_del_dia('2026-10-29')
     group by cam having bool_and(not hecho)) q;
  select count(*) into mudos from (
    select cam from zona_cobertura_del_dia('2026-10-29')
     group by cam having max(posiciones_del_cam) = 0) q;

  raise notice 'CONTROL: % tramos, % zonas, % camiones. En cero: %. Sin ninguna posición ese día: % — y esos dos números NO son lo mismo.',
    n, z, cams, ceros, mudos;
end $$;
