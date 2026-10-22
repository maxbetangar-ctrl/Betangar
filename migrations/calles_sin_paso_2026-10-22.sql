-- ════════════════════════════════════════════════════════════════════════════
--  calles_sin_paso — por qué calles de una parroquia NO hay registro de paso.
--  Pedido por Máximo el 22/10/2026: «muéstrame por dónde no están pasando en
--  Olegario, para avisarle a operaciones por dónde no pasaron para que pasen».
--
--  ⛔ EL MÉTODO, Y POR QUÉ NO ES EL OBVIO. Lo obvio sería preguntar si alguna
--     POSICIÓN cayó cerca de la calle. Eso daría falsos huecos en masa: entre
--     una posición y la siguiente el camión recorre 265 m de mediana (hasta 928
--     en el p90), o sea que **puede recorrer una calle entera sin dejar un punto
--     en ella**. Se usa el TRAMO entre posiciones consecutivas, igual que en
--     `paso_por_aqui`. Eso vive en `gps_celdas`, que se calcula una vez por día.
--
--  ⛔ TRES ESTADOS, NO DOS: `cubierta`, `parcial` y `sin registro`. Y el nombre
--     importa: dice **sin registro de paso**, nunca «no pasó». El equipo se
--     calla hasta 57 minutos con el motor encendido; un rojo que acuse a un
--     chofer de no haber pasado, el día que se equivoque, quema la herramienta
--     entera. Es una LISTA PARA IR A MIRAR, no una condena.
--     [[norma-la-falta-de-dato-no-es-un-dato]]
--
--  ⛔ Y UN DÍA SIN CALCULAR NO ES UN DÍA SIN PASAR. Si el período pedido incluye
--     días que todavía no están en `gps_celdas`, la función lo DICE en vez de
--     contarlos como vacíos: si no, un índice desactualizado haría ver la ciudad
--     entera sin recoger. Para eso está `cobertura_dias_calculados()`.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function cobertura_dias_calculados(p_desde date, p_hasta date)
returns table (dias_pedidos integer, dias_calculados integer, faltan date[])
language sql stable security definer set search_path = public as $$
  with pedidos as (select generate_series(p_desde, p_hasta, '1 day')::date d)
  select (select count(*) from pedidos)::int,
         (select count(*) from pedidos p where exists
            (select 1 from gps_celdas g where g.f = p.d))::int,
         (select coalesce(array_agg(p.d order by p.d), '{}') from pedidos p
           where not exists (select 1 from gps_celdas g where g.f = p.d))
$$;

create or replace function calles_sin_paso(
  p_parroquia text,
  p_desde date default null,
  p_hasta date default null,
  p_min_cobertura numeric default 0.5
) returns table (
  calle_id bigint, nombre text, tipo text, metros integer,
  celdas integer, pisadas integer, cobertura numeric, estado text, geom jsonb
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_desde date := coalesce(p_desde, (now() at time zone 'America/Caracas')::date - 7);
        v_hasta date := coalesce(p_hasta, (now() at time zone 'America/Caracas')::date);
        v_n int; v_falta int;
begin
  perform gps_ve_o_falla();

  select count(*) into v_n from calles where parroquia = p_parroquia;
  if v_n = 0 then
    -- ⛔ Se dice. Devolver cero calles se leería como «está todo cubierto», que
    -- es lo contrario de «esta parroquia no tiene calles cargadas».
    raise exception 'No hay calles cargadas para %. Sin la red de calles no se puede '
      'decir por dónde no se pasó.', p_parroquia;
  end if;

  select dias_pedidos - dias_calculados into v_falta
    from cobertura_dias_calculados(v_desde, v_hasta);
  if v_falta > 0 then
    raise exception 'Faltan % día(s) por calcular en el período pedido. Un día sin '
      'calcular no es un día sin pasar: correr gps_celdas_del_dia() para esos días '
      'antes de mirar la cobertura.', v_falta;
  end if;

  return query
  with pisadas as (
    select distinct celda from gps_celdas where f between v_desde and v_hasta
  ), r as (
    select c.id, c.nombre, c.tipo, c.metros, c.geom,
           count(*)::int celdas,
           count(*) filter (where p.celda is not null)::int pisadas
      from calles c
      join calle_celdas cc on cc.calle_id = c.id
      left join pisadas p on p.celda = cc.celda
     where c.parroquia = p_parroquia
     group by c.id, c.nombre, c.tipo, c.metros, c.geom
  )
  select r.id, r.nombre, r.tipo, r.metros, r.celdas, r.pisadas,
         round(r.pisadas::numeric / nullif(r.celdas,0), 2),
         case when r.pisadas = 0 then 'sin registro'
              when r.pisadas::numeric / r.celdas < p_min_cobertura then 'parcial'
              else 'cubierta' end,
         r.geom
    from r
   order by (r.pisadas::numeric / nullif(r.celdas,0)), r.metros desc;
end $$;

comment on function calles_sin_paso(text, date, date, numeric) is
  'Cobertura calle por calle de una parroquia en un periodo. Mide el TRAMO entre '
  'posiciones (no los puntos sueltos). Tres estados: cubierta, parcial y SIN REGISTRO '
  '- que no es lo mismo que «no paso»: el equipo se calla hasta 57 minutos. '
  'Revienta si al periodo le faltan dias por calcular: un dia sin calcular no es un '
  'dia sin pasar.';

revoke all on function calles_sin_paso(text, date, date, numeric) from anon;
revoke all on function cobertura_dias_calculados(date, date) from anon;

-- ── CONTROL POSITIVO Y NEGATIVO ─────────────────────────────────────────────
do $$
declare uid text; n int; cub int; sin_reg int; nego boolean := false; nego2 boolean := false;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  select count(*), count(*) filter (where estado = 'cubierta'),
         count(*) filter (where estado = 'sin registro')
    into n, cub, sin_reg
    from calles_sin_paso('Parroquia Olegario Villalobos', current_date - 6, current_date);

  if n = 0 then raise exception 'CONTROL: no devolvio ni una calle'; end if;

  -- ⛔ SI NO HAY NI UNA CUBIERTA, LA MEDICION ESTA ROTA, no es que no pasaron:
  -- en Olegario hubo camiones esta semana y eso esta medido aparte.
  if cub = 0 then
    raise exception 'CONTROL POSITIVO FALLO: ninguna calle de Olegario figura cubierta '
      'en 7 dias. O el cruce de celdas esta mal o no se esta leyendo el recorrido.';
  end if;
  -- Y si TODAS estan cubiertas, tampoco sirve: no distinguiria nada.
  if cub = n then
    raise exception 'CONTROL NEGATIVO FALLO: TODAS las calles figuran cubiertas. Una '
      'medicion que nunca dice que falta algo no sirve para buscar huecos.';
  end if;

  -- Una parroquia sin calles cargadas tiene que NEGARSE, no devolver vacio.
  begin
    -- Un nombre que NO existe. La primera version uso «Parroquia Bolivar» y el
    -- control fallo: esa parroquia SI tiene calles cargadas (las que caen dentro
    -- de su limite al asignar por punto medio). La prueba medía otra cosa.
    perform count(*) from calles_sin_paso('Parroquia Que No Existe', current_date - 6, current_date);
  exception when others then
    if position('No hay calles cargadas' in sqlerrm) > 0 then nego := true; else raise; end if;
  end;
  if not nego then
    raise exception 'CONTROL: una parroquia sin calles no se nego; devolvio vacio, que se '
      'leeria como «esta todo cubierto»';
  end if;

  -- Y un periodo con dias SIN CALCULAR tambien tiene que negarse.
  begin
    perform count(*) from calles_sin_paso('Parroquia Olegario Villalobos',
                                          current_date - 400, current_date);
  exception when others then
    if position('Faltan' in sqlerrm) > 0 then nego2 := true; else raise; end if;
  end;
  if not nego2 then
    raise exception 'CONTROL: un periodo con dias sin calcular no se nego: los habria '
      'contado como dias sin pasar';
  end if;

  raise notice 'OK - % calles: % cubiertas, % sin registro', n, cub, sin_reg;
end $$;
