-- ════════════════════════════════════════════════════════════════════════════
--  Marcar las calles que Betangar NO recolecta, para que dejen de ensuciar
--  toda medición de cobertura.
--
--  POR QUÉ. La cobertura decía que a Venancio Pulgar le faltaba el 44% (163 km).
--  Partiendo la parroquia por longitud apareció la causa: **Venancio mide
--  8,9 x 12,8 km, unas diez veces el área de Caracciolo (3,5 x 3,4)**, y se
--  extiende al oeste hacia La Concepción, fuera de la ciudad.
--
--    casco urbano (este de -71,67):   44 calles,   3 sin registro ( 7%)
--    banda intermedia (-71,67/-71,72): 729 calles, 258 sin registro (35%)  92 km
--    periferia oeste (oeste de -71,72): 134 calles, 126 sin registro (94%)  71 km
--
--  ⛔ Máximo, 23/10/2026, mirando esos números: **«esa zona oeste no es de
--     nosotros, márcala»**. O sea que esos 71 km no son un incumplimiento: son
--     territorio que la recolección no atiende, y contarlos como «sin registro»
--     hacía ver un hueco donde no lo hay — y además inflaba la carga de trabajo
--     de Venancio (365 km) contra la que se iba a repartir entre los camiones.
--
--  ⚠️ EL CORTE ES EL QUE SE MIDIÓ Y SE ACORDÓ, Y SE DEJA ESCRITO: longitud
--     -71,72 al oeste, dentro de Venancio Pulgar. No es un límite legal ni sale
--     de ninguna norma: es la línea donde la medición mostró el salto (94% sin
--     registro de un lado, 35% del otro) y sobre la que Máximo decidió. Queda
--     en `motivo` de cada calle para que cualquiera pueda discutirlo con el dato
--     a la vista, y moverlo es un `update`, no una reinterpretación.
--
--  ⛔ NO SE BORRAN. Una calle excluida sigue existiendo con su trazado: el día
--     que la Alcaldía pregunte por esa zona, hay que poder contestar qué se
--     sabe de ella. Lo que cambia es que no se la cuenta como pendiente.
-- ════════════════════════════════════════════════════════════════════════════

alter table calles add column if not exists se_recolecta boolean not null default true;
alter table calles add column if not exists motivo text;

comment on column calles.se_recolecta is
  'false = Betangar no recolecta en esa calle. No se borra: se excluye de la cobertura y '
  'del reparto de trabajo, pero sigue consultable. El porque vive en `motivo`.';

update calles
   set se_recolecta = false,
       motivo = 'Periferia oeste de Venancio Pulgar (al oeste de -71,72), fuera del area '
             || 'que atiende Betangar. Declarado por Maximo el 23/10/2026 sobre la medicion '
             || 'que mostro 94% sin registro de ese lado contra 35% del otro.'
 where parroquia = 'Parroquia Venancio Pulgar'
   and (geom->0->>1)::numeric <= -71.72
   and se_recolecta;

-- ── La cobertura deja de contar lo que no se recolecta ──────────────────────
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

  -- ⚠️ Se cuentan solo las que SÍ se recolectan: si una parroquia entera
  -- quedara marcada como ajena, esto lo dice en vez de devolver vacío.
  select count(*) into v_n from calles
   where parroquia = p_parroquia and se_recolecta;
  if v_n = 0 then
    raise exception 'No hay calles que Betangar recolecte cargadas para %. Sin eso no se '
      'puede decir por dónde no se pasó.', p_parroquia;
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
       and c.se_recolecta          -- lo que no se recolecta no es un pendiente
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

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare uid text; n_fuera int; km_fuera numeric; sr_antes int; sr_ahora int;
        km_trabajo numeric;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  select count(*), round(sum(metros)/1000.0,1) into n_fuera, km_fuera
    from calles where not se_recolecta;
  if n_fuera = 0 then
    raise exception 'CONTROL: no se marco ni una calle. El corte no encontro nada y la '
      'medicion seguiria contando la periferia como pendiente.';
  end if;

  -- ⛔ Y NO PUEDE HABER BARRIDO DE MAS: solo Venancio tiene zona excluida.
  if exists (select 1 from calles where not se_recolecta
                                    and parroquia <> 'Parroquia Venancio Pulgar') then
    raise exception 'CONTROL: se marcaron calles fuera de Venancio Pulgar';
  end if;
  -- Ni puede haberse llevado la parroquia entera.
  if (select count(*) from calles
       where parroquia='Parroquia Venancio Pulgar' and se_recolecta) < 500 then
    raise exception 'CONTROL: quedaron menos de 500 calles recolectables en Venancio: '
      'el corte se llevo demasiado';
  end if;

  select count(*) into sr_ahora
    from calles_sin_paso('Parroquia Venancio Pulgar', current_date - 6, current_date)
   where estado = 'sin registro';
  if sr_ahora >= 387 then
    raise exception 'CONTROL: las sin registro de Venancio no bajaron (siguen %). La '
      'funcion no esta filtrando por se_recolecta.', sr_ahora;
  end if;

  select round(sum(metros*pases)/1000.0,1) into km_trabajo
    from calles where parroquia='Parroquia Venancio Pulgar' and se_recolecta;

  raise notice 'OK - % calles fuera (% km). Venancio: sin registro paso de 387 a %, '
    'y su trabajo real es % km', n_fuera, km_fuera, sr_ahora, km_trabajo;
end $$;
