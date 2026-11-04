-- ════════════════════════════════════════════════════════════════════════════
--  LA ALARMA DE LAS CALLES VIGILADAS TIENE QUE DECIR DÓNDE QUEDAN.
--
--  LO QUE PASÓ (31/10/2026). Se estrenó la alarma con un ensayo forzado —porque
--  los tres días de Olegario (22, 26 y 29/10) las cuatro calles se recorrieron y
--  no había un caso real donde verla disparar— y el mensaje salió así:
--
--      🔴 4 de 4 calle(s) vigilada(s) sin recorrer hoy.
--      • (sin nombre en el callejero) (634 m) — exigida a JAC-B006
--      • (sin nombre en el callejero) (176 m) — exigida a JAC-B006  ...
--
--  Cuatro tramos sin nombre y un metraje. **Con eso no se puede mandar a nadie.**
--  Y es la alarma que más importa del sistema.
--  ⇒ Una alarma que no se vio disparar no está probada: el texto sólo se juzga
--    leyéndolo. [[norma-probar-el-camino-no-la-pieza]]
--
--  LA SOLUCIÓN: cada tramo fijado guarda la calle CON NOMBRE más cercana, que es
--  la referencia que un supervisor puede usar por teléfono.
--
--  ⛔ EL VALOR SE CALCULA, NO SE ESCRIBE. Este repo es PÚBLICO y estos tramos son
--     una dirección sensible del contrato: un nombre de calle escrito acá la
--     ubicaría. La migración computa la referencia desde el callejero que ya está
--     en la base, así que el archivo no contiene ningún dato que identifique nada.
--     Misma razón por la que el punto se llama «Punto de supervisión 1» y el
--     detalle vive en `nota_privada`. [[norma-nada-que-insinue-ia-al-cliente]]
-- ════════════════════════════════════════════════════════════════════════════

alter table zona_calles add column if not exists fijo_referencia text;

comment on column zona_calles.fijo_referencia is $c$La calle CON NOMBRE más cercana a un tramo fijado, para que el aviso diga dónde queda. Los tramos vigilados no tienen nombre en OpenStreetMap, y un aviso que dice «(sin nombre) 634 m» no se puede cumplir: nadie sabe a dónde mandar la unidad. Se calcula al fijar, no se escribe a mano — el repo es público y estos tramos son una dirección sensible.$c$;

-- Se calcula para todos los tramos fijados que todavía no la tengan.
update zona_calles f
   set fijo_referencia = (
     select zc.nombre from zona_calles zc
      where zc.nombre is not null and btrim(zc.nombre) <> ''
        and zc.la_min between f.la_min - 0.003 and f.la_max + 0.003
        and zc.lo_min between f.lo_min - 0.003 and f.lo_max + 0.003
      order by _dist_a_tramo_m((f.la_min + f.la_max) / 2, (f.lo_min + f.lo_max) / 2,
                 (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
                 (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8)
      limit 1)
 where f.fijo_cam is not null and f.fijo_referencia is null;

-- ── La función devuelve la referencia ───────────────────────────────────────
drop function if exists calles_fijas_del_dia(date);

create function calles_fijas_del_dia(p_fecha date default null)
returns table (
  tramo bigint, nombre text, metros integer, parroquia text,
  cam_exigido text, le_tocaba boolean, recorrida boolean,
  quien text, posiciones bigint, desde timestamptz, hasta timestamptz,
  referencia text
)
language sql stable security definer set search_path = public as $$
  with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
  toca as (
    select distinct c.parroquia from f, cronograma_del_dia(f.d) c where c.parroquia is not null
  ),
  t as (
    select zc.id, coalesce(zc.nombre, '(sin nombre en el callejero)') nombre,
           round(zc.metros)::int metros, zc.parroquia, zc.fijo_cam, zc.geom,
           zc.la_min, zc.la_max, zc.lo_min, zc.lo_max, zc.fijo_referencia
      from zona_calles zc where zc.fijo_cam is not null
  ),
  paso as (
    -- La regla del producto, la misma de `zona_cobertura_del_dia`: a <=45 m del tramo,
    -- con el camion trabajando.
    -- ⚠️ El filtro por día usa el índice BRIN de `ts` creado el 31/10: sin él, esta
    --    consulta recorría las 330 mil posiciones y la función se pasaba del
    --    statement timeout de PostgREST — devolviendo vacío, que se lee igual que
    --    «está todo recorrido». 6,6 s → 0,6 s.
    select t.id, p.cam, count(*) n, min(p.ts) desde, max(p.ts) hasta
      from t
      cross join f
      join gps_posiciones p
        on p.ts >= (f.d::timestamp at time zone 'America/Caracas')
       and p.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
       and p.lat between t.la_min - 0.0004 and t.la_max + 0.0004
       and p.lon between t.lo_min - 0.0004 and t.lo_max + 0.0004
       and (p.velocidad <= 15 or p.ignicion is true)
       and _dist_a_tramo_m(p.lat, p.lon,
             (t.geom->0->>0)::float8,  (t.geom->0->>1)::float8,
             (t.geom->-1->>0)::float8, (t.geom->-1->>1)::float8) <= 45
     group by t.id, p.cam
  ),
  -- ⛔ Primero se busca al EXIGIDO. Que haya pasado otro no cumple: la calle tiene dueño
  --    declarado justamente para que no dependa de quien ande cerca.
  suyo as (
    select p.* from paso p join t on t.id = p.id and t.fijo_cam = p.cam
  ),
  ajeno as (
    select p.id, p.cam, p.n, p.desde, p.hasta,
           row_number() over (partition by p.id order by p.n desc) rn
      from paso p join t on t.id = p.id and t.fijo_cam <> p.cam
  )
  select t.id, t.nombre, t.metros, t.parroquia, t.fijo_cam,
         (t.parroquia in (select parroquia from toca)),
         (s.id is not null),
         coalesce(s.cam, a.cam), coalesce(s.n, a.n, 0),
         coalesce(s.desde, a.desde), coalesce(s.hasta, a.hasta),
         t.fijo_referencia
    from t
    left join suyo s on s.id = t.id
    left join ajeno a on a.id = t.id and a.rn = 1
   order by (t.parroquia in (select parroquia from toca)) desc, (s.id is null) desc, t.metros desc
$$;

comment on function calles_fijas_del_dia(date) is $c$Calle por calle, si el camión EXIGIDO recorrió los tramos fijados ese día. `le_tocaba` dice si la parroquia salió según el cronograma; `recorrida`, si pasó el exigido; `quien` nombra a otro que haya pasado — que NO cumple, porque el tramo tiene dueño declarado para que no dependa de quien ande cerca. `referencia` es la calle con nombre más cercana: sin ella el aviso decía «(sin nombre) 634 m» y no se podía mandar a nadie.$c$;

revoke all on function calles_fijas_del_dia(date) from anon;
grant execute on function calles_fijas_del_dia(date) to authenticated;
grant execute on function calles_fijas_del_dia(date) to service_role;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $v$
declare v_sin int; v_tot int; v_ms numeric; v_t timestamptz;
begin
  select count(*), count(*) filter (where fijo_referencia is null)
    into v_tot, v_sin from zona_calles where fijo_cam is not null;
  if v_tot = 0 then
    raise exception 'no hay ningun tramo fijado: no habia nada que etiquetar';
  end if;
  if v_sin > 0 then
    raise exception '% de % tramos fijados quedaron SIN referencia: el aviso seguiria sin decir donde', v_sin, v_tot;
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_t := clock_timestamp();
  perform count(*) from calles_fijas_del_dia(current_date);
  v_ms := extract(milliseconds from (clock_timestamp() - v_t))
        + 1000 * extract(seconds from (clock_timestamp() - v_t));
  if v_ms > 3000 then
    raise warning 'tarda % ms: PostgREST la puede cortar', round(v_ms);
  end if;

  -- Y que la columna nueva de verdad llegue a la salida.
  if not exists (select 1 from calles_fijas_del_dia(current_date) where referencia is not null) then
    raise exception 'la funcion no esta devolviendo la referencia';
  end if;
  raise notice 'OK · % tramos fijados, todos con referencia (% ms)', v_tot, round(v_ms);
end $v$;
