-- ════════════════════════════════════════════════════════════════════════════
--  El cronograma de recolección, declarado por Máximo el 22/10/2026.
--
--    lunes y jueves   → Olegario Villalobos (7) + Santa Lucía (2)
--    martes y viernes → Caracciolo Parra Pérez (12)
--    miércoles y sábado → Venancio Pulgar (12)
--    domingo          → operativo que define el IMAU (sin parroquia fija)
--
--  ⛔ EL DOMINGO SE GUARDA EXPLÍCITO, NO COMO AUSENCIA DE FILAS. Un domingo sin
--     filas se lee igual que «el cronograma no está cargado», y la pantalla
--     diría «hoy no toca nada» tanto si el IMAU no definió operativo como si
--     alguien se olvidó de cargar los datos. Son dos cosas distintas y hay que
--     poder distinguirlas. Por eso existe `tipo='operativo_imau'`.
--     [[norma-falta-de-dato-no-es-un-dato]] [[norma-control-positivo-antes-de-creerle-al-vacio]]
--
--  ⚠️ LOS «12 CAMIONES» SON LOS QUE DECLARA EL CRONOGRAMA, NO LOS QUE SE PUEDEN
--     VER. Solo 10 de las 12 unidades tienen GPS: JAC-B011 y JAC-B012 no están
--     en la cuenta del proveedor. Así que un día de 12 nunca va a mostrar más de
--     10 en el mapa, y eso NO es un incumplimiento. Lo que se guarda acá es lo
--     comprometido; cualquier pantalla que compare contra esto tiene que decir
--     esa diferencia con todas las letras o va a acusar a la empresa sola.
--
--  📌 `extract(dow)` de Postgres: 0 = domingo, 1 = lunes … 6 = sábado.
--
--  📌 `vigente_desde` existe porque un cronograma CAMBIA. El día que la Alcaldía
--     reasigne parroquias, lo viejo no se borra: se carga la versión nueva y la
--     anterior queda para poder leer un día pasado con la regla que regía ese
--     día. [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists cronograma_recoleccion (
  id            bigserial primary key,
  dia_semana    smallint not null check (dia_semana between 0 and 6),
  tipo          text not null default 'parroquia'
                  check (tipo in ('parroquia', 'operativo_imau')),
  parroquia     text references parroquias(nombre),
  camiones      integer check (camiones is null or camiones > 0),
  nota          text,
  vigente_desde date not null default current_date,
  creado        timestamptz not null default now(),
  -- Una parroquia no puede estar dos veces el mismo día en la misma versión.
  unique (vigente_desde, dia_semana, parroquia),
  -- Si es parroquia, hay parroquia y hay camiones. Si es operativo, no hay ni
  -- una ni otros: un operativo con 12 camiones declarados sería inventar un
  -- compromiso que nadie asumió.
  check ( (tipo = 'parroquia'      and parroquia is not null and camiones is not null)
       or (tipo = 'operativo_imau' and parroquia is null     and camiones is null) )
);

comment on table cronograma_recoleccion is
  'Qué parroquia le toca a Betangar cada día y con cuántos camiones. El domingo va '
  'explícito como `operativo_imau` para poder distinguir «lo define el IMAU» de «el '
  'cronograma no está cargado». `camiones` es lo COMPROMETIDO, no lo que se puede ver: '
  'solo 10 de 12 unidades tienen GPS.';

-- ── El cronograma vigente ───────────────────────────────────────────────────
insert into cronograma_recoleccion (dia_semana, tipo, parroquia, camiones, vigente_desde)
values
  (1, 'parroquia', 'Parroquia Olegario Villalobos',    7,  '2026-10-22'),
  (1, 'parroquia', 'Parroquia Santa Lucía',            2,  '2026-10-22'),
  (4, 'parroquia', 'Parroquia Olegario Villalobos',    7,  '2026-10-22'),
  (4, 'parroquia', 'Parroquia Santa Lucía',            2,  '2026-10-22'),
  (2, 'parroquia', 'Parroquia Caracciolo Parra Pérez', 12, '2026-10-22'),
  (5, 'parroquia', 'Parroquia Caracciolo Parra Pérez', 12, '2026-10-22'),
  (3, 'parroquia', 'Parroquia Venancio Pulgar',        12, '2026-10-22'),
  (6, 'parroquia', 'Parroquia Venancio Pulgar',        12, '2026-10-22')
on conflict (vigente_desde, dia_semana, parroquia) do update
   set camiones = excluded.camiones
 where cronograma_recoleccion.vigente_desde = excluded.vigente_desde;

-- El domingo, declarado. No es una fila de relleno: es el dato.
insert into cronograma_recoleccion (dia_semana, tipo, parroquia, camiones, nota, vigente_desde)
select 0, 'operativo_imau', null, null,
       'El operativo del domingo lo define el IMAU; no hay parroquia asignada de antemano.',
       '2026-10-22'
where not exists (select 1 from cronograma_recoleccion
                   where dia_semana = 0 and vigente_desde = '2026-10-22');

-- ── Qué toca un día ─────────────────────────────────────────────────────────
create or replace function cronograma_del_dia(p_fecha date default null)
returns table (f date, dia text, tipo text, parroquia text, camiones integer, nota text)
language plpgsql stable security definer set search_path = public as $$
declare v_f date := coalesce(p_fecha, (now() at time zone 'America/Caracas')::date);
        v_dow smallint;
begin
  perform gps_ve_o_falla();
  v_dow := extract(dow from v_f)::smallint;
  return query
  select v_f,
         (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[v_dow + 1],
         c.tipo, c.parroquia, c.camiones, c.nota
    from cronograma_recoleccion c
   where c.dia_semana = v_dow
     -- La versión que regía ESE día, no la de hoy.
     and c.vigente_desde = (select max(vigente_desde) from cronograma_recoleccion
                             where dia_semana = v_dow and vigente_desde <= v_f)
   order by c.camiones desc nulls last, c.parroquia;
end $$;

comment on function cronograma_del_dia(date) is
  'Qué le toca a Betangar ese día, según la versión del cronograma que regía ESE día. '
  'Domingo devuelve una fila con tipo=operativo_imau: eso es «lo define el IMAU», y es '
  'distinto de no devolver filas, que sería «no hay cronograma cargado».';

revoke all on function cronograma_del_dia(date) from anon;

alter table cronograma_recoleccion enable row level security;
drop policy if exists cronograma_sel on cronograma_recoleccion;
create policy cronograma_sel on cronograma_recoleccion for select to authenticated
  using (app_rol() = any (array['superadmin','admin','operador','visualizador','directivo',
                               'auditor','revisor','operativo','mecanico','rrhh']));

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
do $$
declare uid text; n int; dom int; lun int; nombre text;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- ⚠️ SE PRUEBAN LOS PRÓXIMOS 7 DÍAS, NO LA SEMANA EN CURSO. La primera versión
  --    arrancaba en el lunes de esta semana —anterior a `vigente_desde`— y el
  --    control reventó con «el día 0 no devuelve nada». No era un defecto: una
  --    fecha anterior a la vigencia del cronograma DEBE devolver vacío, porque
  --    ese día todavía no regía esta regla. Lo que estaba mal era la prueba.
  --    📌 Y queda dicho para la pantalla: «sin cronograma vigente» es un tercer
  --    estado, distinto de «hoy no toca nada».
  for n in 0..6 loop
    if (select count(*) from cronograma_del_dia(current_date + n)) = 0 then
      raise exception 'CONTROL: el día % (desde hoy) no devuelve nada', n;
    end if;
  end loop;

  -- El próximo lunes: DOS parroquias y 9 camiones en total.
  select count(*), sum(camiones) into lun, n
    from cronograma_del_dia(
      current_date + ((8 - extract(dow from current_date)::int) % 7 + case
        when extract(dow from current_date)::int = 1 then 7 else 0 end));
  if lun <> 2 or n <> 9 then
    raise exception 'CONTROL: el lunes dio % parroquias y % camiones; se esperaban 2 y 9', lun, n;
  end if;

  -- El próximo domingo tiene que decir que es operativo del IMAU, no venir vacío.
  select count(*) into dom from cronograma_del_dia(
    current_date + ((7 - extract(dow from current_date)::int) % 7 + case
      when extract(dow from current_date)::int = 0 then 7 else 0 end))
   where tipo = 'operativo_imau';
  if dom <> 1 then
    raise exception 'CONTROL: el domingo no quedó declarado como operativo del IMAU';
  end if;

  -- Y las parroquias del cronograma tienen que EXISTIR con su límite cargado:
  -- una que no exista haría que el mapa no pueda pintar lo que toca hoy.
  select string_agg(c.parroquia, ', ') into nombre
    from cronograma_recoleccion c
    left join parroquias p on p.nombre = c.parroquia
   where c.tipo = 'parroquia' and (p.nombre is null or p.es_nuestra is not true);
  if nombre is not null then
    raise exception 'CONTROL: el cronograma nombra parroquias que no están cargadas '
      'como nuestras: %', nombre;
  end if;

  raise notice 'OK - los 7 dias contestan, el lunes son 2 parroquias y 9 camiones, '
    'el domingo es operativo del IMAU, y las 4 parroquias existen';
end $$;
