-- ════════════════════════════════════════════════════════════════════════════
--  Las celdas: el índice que hace que la cobertura se pueda consultar.
--
--  ⛔ POR QUÉ EXISTE. La primera versión de `calles_sin_paso` calculaba TODO en
--     cada llamada: interpolaba 7 días de recorrido (≈40.000 tramos) y las 595
--     calles de la parroquia, y cruzaba. **No volvía**: la consola cortó por
--     tiempo tres veces seguidas. El trabajo estaba bien; el momento, mal.
--
--  Se parte en dos índices que se calculan UNA vez:
--   · `calle_celdas`  — qué celdas de ~100 m ocupa cada calle. Es estático: las
--     calles no se mueven. Se calcula al cargar la red y no se toca más.
--   · `gps_celdas`    — qué celdas pisó la flota cada día. Crece un día por día
--     y se llena con `gps_celdas_del_dia()`, que es lo único pesado y corre una
--     vez por jornada, no una vez por pregunta.
--
--  Con eso, «¿por qué calles no se pasó esta semana?» es un cruce de conjuntos.
-- ════════════════════════════════════════════════════════════════════════════

-- La celda: ~100 m de lado a esta latitud. Sale como texto para poder cruzar
-- conjuntos con un simple join.
-- ⛔ Vivia en la migracion de `calles_sin_paso`, que se corto por tiempo y nunca
--    llego a aplicarse: las dos tablas de abajo quedaron creadas y sus cargadores
--    reventaban con «function _celda does not exist». Una pieza de la que
--    dependen otras no puede vivir en el archivo mas fragil.
create or replace function _celda(p_lat double precision, p_lon double precision)
returns text language sql immutable as $c$
  select floor(p_lat / 0.0009)::bigint::text || ':' || floor(p_lon / 0.0009)::bigint::text
$c$;

create table if not exists calle_celdas (
  calle_id bigint not null references calles(id) on delete cascade,
  celda    text   not null,
  primary key (calle_id, celda)
);
create index if not exists calle_celdas_celda on calle_celdas (celda);

create table if not exists gps_celdas (
  f      date not null,
  celda  text not null,
  primary key (f, celda)
);
create index if not exists gps_celdas_celda on gps_celdas (celda);

comment on table calle_celdas is
  'Que celdas de ~100 m ocupa cada calle. Estatico: se calcula al cargar la red.';
comment on table gps_celdas is
  'Que celdas piso la flota cada dia, interpolando el TRAMO entre posiciones (no los '
  'puntos sueltos: entre uno y otro el camion recorre 265 m de mediana). Un dia que no '
  'esta en esta tabla es un dia SIN CALCULAR, que no es lo mismo que un dia sin pasar.';

alter table calle_celdas enable row level security;
alter table gps_celdas   enable row level security;
drop policy if exists calle_celdas_sel on calle_celdas;
create policy calle_celdas_sel on calle_celdas for select to authenticated
  using (app_rol() is not null);
drop policy if exists gps_celdas_sel on gps_celdas;
create policy gps_celdas_sel on gps_celdas for select to authenticated
  using (app_rol() is not null);

-- ── Llenar las celdas de una parroquia (una sola vez) ───────────────────────
create or replace function calle_celdas_cargar(p_parroquia text)
returns integer language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare n int;
begin
  insert into calle_celdas (calle_id, celda)
  select distinct x.id,
         _celda(x.la + (x.lat - x.la) * (i::numeric / greatest(x.pasos,1)),
                x.lo + (x.lon - x.lo) * (i::numeric / greatest(x.pasos,1)))
    from (
      select v.id, v.lat, v.lon, v.la, v.lo,
             ceil(greatest(_dist_a_tramo_m(v.la, v.lo, v.lat, v.lon, v.lat, v.lon), 1) / 40.0)::int pasos
        from (
          select c.id,
                 (e.valor->>0)::double precision lat, (e.valor->>1)::double precision lon,
                 lag((e.valor->>0)::double precision) over (partition by c.id order by e.i) la,
                 lag((e.valor->>1)::double precision) over (partition by c.id order by e.i) lo
            from calles c,
                 lateral (select i, valor from jsonb_array_elements(c.geom)
                           with ordinality t(valor, i)) e
           where c.parroquia = p_parroquia
        ) v where v.la is not null
    ) x, generate_series(0, least(x.pasos, 100)) i
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Llenar las celdas que pisó la flota UN día ──────────────────────────────
create or replace function gps_celdas_del_dia(p_fecha date, p_minutos_tramo integer default 5)
returns integer language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare n int;
begin
  insert into gps_celdas (f, celda)
  select distinct p_fecha,
         _celda(t.la + (t.lat - t.la) * (i::numeric / greatest(t.pasos,1)),
                t.lo + (t.lon - t.lo) * (i::numeric / greatest(t.pasos,1)))
    from (
      select pos.la, pos.lo, pos.lat, pos.lon,
             ceil(greatest(_dist_a_tramo_m(pos.la, pos.lo, pos.lat, pos.lon, pos.lat, pos.lon), 1) / 40.0)::int pasos
        from (
          select p.lat, p.lon,
                 lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0, p.ts
            from gps_posiciones p
           where (p.ts at time zone 'America/Caracas')::date = p_fecha
          window w as (partition by p.cam order by p.ts)
        ) pos
       where pos.t0 is not null
         -- ⛔ Un tramo largo NO se rellena: unir los dos extremos de un silencio
         -- de 57 minutos marcaria como recorridas calles por las que nadie paso.
         and extract(epoch from (pos.ts - pos.t0))/60.0 <= p_minutos_tramo
    ) t, generate_series(0, least(t.pasos, 200)) i
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function calle_celdas_cargar(text) from anon, authenticated;
revoke all on function gps_celdas_del_dia(date, integer) from anon, authenticated;
