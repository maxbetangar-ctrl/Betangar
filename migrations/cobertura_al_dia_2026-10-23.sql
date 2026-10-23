-- ════════════════════════════════════════════════════════════════════════════
--  Lo que falta para que la cobertura se pueda pintar en el mapa:
--   1. `calles_faltantes` — solo las que NO están cubiertas, con su trazado.
--   2. Una tarea que mantenga `gps_celdas` al día.
--
--  ⛔ POR QUÉ LA TAREA NO ES UN LUJO. `calles_sin_paso` se NIEGA si al período
--     le faltan días en el índice (y está bien: un día sin calcular no es un día
--     sin pasar). Pero eso significa que **sin una tarea que lo llene, la
--     pantalla deja de funcionar mañana**, y el síntoma sería un error en la
--     cara del usuario, no un hueco silencioso. Se llena cada hora el día de hoy
--     y el de ayer: hoy porque la jornada está en curso, ayer porque un camión
--     que entra a las 23:50 deja posiciones que recién se cierran pasada la
--     medianoche.
--
--  ⛔ Y SE RECALCULA, NO SE AGREGA A CIEGAS: `gps_celdas_del_dia` hace
--     `on conflict do nothing`, así que volver a correrlo sobre un día ya hecho
--     solo suma lo nuevo. Correrlo de más es barato; correrlo de menos deja la
--     pantalla sin contestar.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function calles_faltantes(
  p_parroquia text default null,
  p_desde date default null,
  p_hasta date default null,
  p_min_cobertura numeric default 0.5
) returns table (
  parroquia text, calle_id bigint, nombre text, metros integer,
  cobertura numeric, estado text, geom jsonb
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_p text;
begin
  perform gps_ve_o_falla();
  for v_p in select p.nombre from parroquias p
              where p.es_nuestra and (p_parroquia is null or p.nombre = p_parroquia)
              order by p.nombre loop
    return query
      select v_p, c.calle_id, c.nombre, c.metros, c.cobertura, c.estado, c.geom
        from calles_sin_paso(v_p, p_desde, p_hasta, p_min_cobertura) c
       where c.estado <> 'cubierta';
  end loop;
end $$;

comment on function calles_faltantes(text, date, date, numeric) is
  'Solo las calles sin registro o parciales, de una parroquia o de las cuatro. Es lo '
  'que pinta el mapa: mandar tambien las 515 cubiertas seria mandar un megabyte para '
  'tapar la pantalla de lineas que no hay que mirar.';

revoke all on function calles_faltantes(text, date, date, numeric) from anon;

-- ── La tarea que mantiene el índice al día ──────────────────────────────────
create or replace function gps_celdas_al_dia() returns text
language plpgsql security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Caracas')::date;
        n_hoy int; n_ayer int;
begin
  n_ayer := gps_celdas_del_dia(hoy - 1);
  n_hoy  := gps_celdas_del_dia(hoy);
  return format('ayer +%s celdas, hoy +%s celdas', n_ayer, n_hoy);
end $$;

select cron.schedule('gps-celdas-betangar', '7 * * * *',
                     $f$select public.gps_celdas_al_dia();$f$);

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare uid text; n int; act boolean; falta int;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- La tarea tiene que existir y estar activa, o la pantalla muere mañana.
  select active into act from cron.job where jobname = 'gps-celdas-betangar';
  if act is not true then
    raise exception 'CONTROL: la tarea `gps-celdas-betangar` no quedo activa: sin ella '
      '`calles_sin_paso` deja de contestar en cuanto pase un dia';
  end if;

  -- Y el dia de hoy tiene que estar calculado AHORA, no solo dentro de una hora.
  perform gps_celdas_al_dia();
  select dias_pedidos - dias_calculados into falta
    from cobertura_dias_calculados((now() at time zone 'America/Caracas')::date - 6,
                                   (now() at time zone 'America/Caracas')::date);
  if falta > 0 then
    raise exception 'CONTROL: quedan % dia(s) sin calcular en los ultimos 7', falta;
  end if;

  select count(*) into n from calles_faltantes(null,
    (now() at time zone 'America/Caracas')::date - 6,
    (now() at time zone 'America/Caracas')::date);
  if n = 0 then
    raise exception 'CONTROL: no devolvio ni una calle faltante en las 4 parroquias. '
      'Que no falte NINGUNA en una semana es mas probable que un error de medicion.';
  end if;

  raise notice 'OK - tarea activa, 7 dias calculados, % calles faltantes en las 4', n;
end $$;
