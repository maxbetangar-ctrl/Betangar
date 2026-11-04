-- BETANGAR — PUNTOS VIGILADOS: direcciones que NO se pueden dejar sin limpiar
-- Fecha: 2026-10-30
--
-- Pedido de Máximo el 30/10/2026: mandó una ubicación por WhatsApp y pidió marcarla
-- «para que supervises que cuando toque esa parroquia no dejen de limpiarla».
--
-- ⛔ LAS COORDENADAS NO VAN EN ESTE ARCHIVO, Y NO ES UN DESCUIDO. El repo `Betangar` es
--    PÚBLICO. Una dirección particular publicada en GitHub no se despublica. Los puntos
--    se cargan por script contra la base, igual que `configuracion.gps_reenvio_url`.
--    Esta migración crea la tabla y el control; el dato entra aparte.
--    [[norma-secreto-nunca-en-el-codigo]]
--
-- ⛔ Y LA ETIQueta ES NEUTRA A PROPÓSITO. `nombre` es lo que se ve en el mapa y lo puede
--    leer cualquiera con acceso, incluidos los choferes. De quién es la casa va en
--    `nota_privada`, que solo leen los roles de dirección. Un punto que dice en pantalla
--    de quién es la casa convierte un control de servicio en un dato personal paseándose
--    por la flota.
--
-- ── CÓMO VIGILA, y por qué así ───────────────────────────────────────────────
--
-- ⛔ NO se vigila «que pase el camión de SU zona». El primer punto cargado cae justo en el
--    borde de tres zonas: `zona_en_punto` lo da en la zona 3 (B006) a 6 m, y las calles
--    más cercanas del callejero son de la zona 8 (B005) a 8 m, la zona 4 (B003) a 54 m y
--    la zona 3 a 89 m. Encima la calle NO TIENE NOMBRE en el callejero. Exigir un camión
--    concreto sería vigilar al chofer equivocado por un empate de 2 metros.
--    ⇒ Se vigila que haya pasado ALGUIEN a menos del radio. Es lo que se pidió —que no
--      quede sin limpiar— y no depende de resolver el borde.
--
-- ⚠️ «Pasó cerca» NO es «limpió». El GPS prueba que la unidad estuvo ahí, no que recogió.
--    Un camión que cruza la cuadra a 40 km/h cuenta como paso y no limpió nada: por eso
--    el control pide velocidad baja o motor encendido, igual que el resto del módulo. Y
--    aun así es un indicio, no una prueba. Eso se dice en el aviso, no se infla.
--
-- ⛔ Y SOLO SE REVISA EL DÍA QUE LA PARROQUIA LE TOCA. Revisar todos los días daría
--    «sin pasar» seis de cada siete veces y sería el aviso que salta siempre. El
--    cronograma manda: `cronograma_del_dia`.

begin;

create table if not exists public.puntos_vigilados (
  id            bigserial primary key,
  nombre        text not null,              -- lo que se ve en el mapa. NEUTRO.
  lat           double precision not null,
  lon           double precision not null,
  radio_m       integer not null default 50,
  parroquia     text,                       -- la nuestra en que cae; la calcula el alta
  nota_privada  text,                       -- de quién/qué es. NO va al mapa.
  activo        boolean not null default true,
  pedido_por    text,
  creado        timestamptz not null default now()
);

comment on table public.puntos_vigilados is
  'Direcciones que no se pueden dejar sin limpiar. Se revisa el día que el cronograma manda '
  'esa parroquia, y se pide que haya pasado ALGUNA unidad dentro del radio, no una en '
  'particular: un punto en el borde de dos zonas no tiene dueño claro. '
  '⚠️ Pasar cerca no es limpiar: es un indicio.';
comment on column public.puntos_vigilados.nombre is
  'Se MUESTRA en el mapa. Que sea neutro: lo lee cualquiera con acceso, choferes incluidos.';
comment on column public.puntos_vigilados.nota_privada is
  'Para qué o de quién es. NO se muestra en el mapa ni se manda en ningún aviso.';

alter table public.puntos_vigilados enable row level security;
revoke all on public.puntos_vigilados from anon;
grant select on public.puntos_vigilados to authenticated;

-- El punto en el mapa lo ve quien opera; la nota privada, no (la columna se filtra en la
-- consulta de la app — acá se corta por rol quién ve la FILA).
create policy puntos_vigilados_sel on public.puntos_vigilados
  for select to authenticated
  using ( app_rol() = any(array['superadmin','admin','operador','visualizador','directivo',
                                'auditor','revisor','operativo']) );

-- ── El control: ¿pasó alguien hoy por cada punto que le tocaba? ─────────────
create or replace function public.puntos_vigilados_del_dia(p_fecha date default null)
returns table (
  id bigint, nombre text, parroquia text, le_tocaba boolean,
  paso boolean, cam text, hora timestamptz, a_metros integer, posiciones bigint
)
language sql stable security definer set search_path = public as $$
  with f as (select coalesce(p_fecha, (now() at time zone 'America/Caracas')::date) d),
  toca as (
    -- Las parroquias que el cronograma manda ese día. Si el punto no es de ninguna, su
    -- día no es hoy y no se le reclama nada.
    select distinct c.parroquia from f, cronograma_del_dia(f.d) c where c.parroquia is not null
  ),
  cerca as (
    select v.id, p.cam, p.ts, p.lat, p.lon,
           _dist_a_tramo_m(v.lat, v.lon, p.lat, p.lon, p.lat, p.lon) m
      -- ⛔ `cross join f` y no `, f`: con la coma, Postgres no deja referenciar `v` dentro
      --    del `ON` del join siguiente («invalid reference to FROM-clause entry»). La
      --    forma explicita pone las tres tablas en el mismo alcance.
      from puntos_vigilados v
      cross join f
      join gps_posiciones p
        on p.ts >= (f.d::timestamp at time zone 'America/Caracas')
       and p.ts <  ((f.d + 1)::timestamp at time zone 'America/Caracas')
       -- caja primero: cuatro comparaciones antes de la cuenta de distancia
       and p.lat between v.lat - 0.0012 and v.lat + 0.0012
       and p.lon between v.lon - 0.0012 and v.lon + 0.0012
       -- ⛔ «pasó» pide trabajo, no tránsito: lento, o con el motor encendido.
       and (p.velocidad <= 15 or p.ignicion is true)
     where v.activo
  ),
  mejor as (
    select c.id, c.cam, c.ts, c.m,
           row_number() over (partition by c.id order by c.m) rn,
           count(*) over (partition by c.id) n
      from cerca c, puntos_vigilados v where v.id = c.id and c.m <= v.radio_m
  )
  select v.id, v.nombre, v.parroquia,
         (v.parroquia in (select parroquia from toca)) le_tocaba,
         (m.id is not null) paso,
         m.cam, m.ts, round(m.m)::int, coalesce(m.n, 0)
    from puntos_vigilados v
    left join mejor m on m.id = v.id and m.rn = 1
   where v.activo
   order by (v.parroquia in (select parroquia from toca)) desc, (m.id is null) desc, v.nombre
$$;

comment on function public.puntos_vigilados_del_dia(date) is
  'Por cada punto vigilado: si ese día le tocaba su parroquia según el cronograma, y si '
  'pasó alguna unidad dentro del radio trabajando (lento o con motor encendido). '
  '⛔ `le_tocaba = false` no es una falta: ese día esa parroquia no sale. '
  '⚠️ `paso = true` dice que la unidad ESTUVO, no que limpió.';

revoke all on function public.puntos_vigilados_del_dia(date) from anon;
grant execute on function public.puntos_vigilados_del_dia(date) to authenticated, service_role;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select * from puntos_vigilados_del_dia();
--   → con un punto en Olegario Villalobos y hoy viernes: `le_tocaba = false`, porque
--     Olegario sale LUNES Y JUEVES. El primer día de verdad es el lunes 2/11/2026.
-- ⛔ CONTROL POSITIVO, que sepa decir SI y no solo NO:
-- select * from puntos_vigilados_del_dia('2026-10-29');   -- jueves: Olegario SI salio
--   → `le_tocaba = true`, y `paso` tiene que decir que alguna unidad estuvo ahi.
--   Si con un dia en que la parroquia SI salio sigue diciendo que no paso nadie, el
--   control no esta midiendo: esta callado.
