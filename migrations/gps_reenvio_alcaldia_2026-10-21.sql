-- ════════════════════════════════════════════════════════════════════════════
--  gps_reenvio_alcaldia — la base del reenvío de posiciones a IMAU Flota
--                         (la plataforma propia de la Alcaldía).
--  Escrito el 21/10/2026. Especificación dada por Leonel (técnico de la
--  Alcaldía) ese mismo día: protocolo OsmAnd, el de Traccar Client, por HTTP.
--
--  ⛔ EL REQUISITO QUE MANDA SOBRE TODO LO DEMÁS (Máximo, 21/10):
--     «debe ser los datos más exactos posibles porque después la Alcaldía
--      puede pensar que no estuve en un sitio que sí estuve».
--  Eso no se cumple con una promesa en un comentario: se cumple con un cuadre
--  que CUENTA lo que hay contra lo que salió, unidad por unidad y día por día
--  (`gps_reenvio_cuadre`). Un punto que no se mandó tiene que poder nombrarse.
--  [[norma-la-falta-de-dato-no-es-un-dato]]
--
--  LAS DECISIONES Y POR QUÉ
--
--  1. LA DIRECCIÓN VIVE EN `configuracion`, NO EN EL CÓDIGO.
--     Ese endpoint NO LLEVA USUARIO NI CLAVE: identifica al equipo por su IMEI
--     y nada más. O sea que la dirección, en la práctica, ES la credencial:
--     cualquiera que la tenga junto a un IMEI puede meterle a la Alcaldía
--     posiciones falsas de nuestros camiones. Y el repo `Betangar` es PÚBLICO.
--     [[norma-secreto-nunca-en-el-codigo]]
--
--  2. UN CURSOR POR UNIDAD, Y NO AVANZA SOBRE UN FALLO.
--     `gps_posiciones` es append-only con llave única (cam, ts), así que un
--     cursor por unidad alcanza para no repetir y no saltear. ⛔ La regla que
--     hace la diferencia: el cursor avanza SOLO hasta la última posición que
--     salió BIEN, en orden cronológico, y se detiene en el primer fallo. Si
--     avanzara igual, un error de red se volvería un hueco permanente en el
--     mapa de la Alcaldía — justo el «no estuve» que hay que evitar.
--
--  3. EL CURSOR ARRANCA EN EL MOMENTO DE INSTALAR, NO EN EL 14/08.
--     Hay 261.408 posiciones guardadas desde que empezó el sondeo. Volcarlas
--     de golpe son 261.408 peticiones a un servidor ajeno: eso se pide antes,
--     no se hace de sorpresa. El relleno histórico es una decisión aparte
--     (`gps_reenvio_estado.enviado_hasta` se puede mover a mano) y hay que
--     consultarla con Leonel.
--
--  4. EL IMEI SE DECLARA EN `gps_equipos`, NO SE LEE DE UNA POSICIÓN.
--     El sondeo venía guardando el IMEI del aparato en
--     `gps_posiciones.id_equipo` desde agosto (medido el 21/10: los 10, de 15
--     dígitos, uno por unidad). Pero el reenvío manda el DECLARADO: si un día
--     una posición trae otro IMEI, eso es un aparato cambiado de camión y
--     tiene que GRITAR, no normalizarse en silencio — la misma lección que la
--     placa de JAC-B008. Para eso está `gps_reenvio_imei_discrepante()`.
--
--  5. LAS UNIDADES SIN IMEI DECLARADO NO SE MANDAN.
--     JAC-B011 y JAC-B012 no están en la cuenta del proveedor, así que no
--     tienen IMEI medido. Mandar un `id` vacío le mete a la Alcaldía un camión
--     fantasma. Se quedan afuera y el cuadre lo dice.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. El IMEI, declarado ───────────────────────────────────────────────────
alter table gps_equipos add column if not exists imei text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gps_equipos_imei_15') then
    alter table gps_equipos
      add constraint gps_equipos_imei_15 check (imei is null or imei ~ '^[0-9]{15}$');
  end if;
end $$;

comment on column gps_equipos.imei is
  'IMEI del aparato, 15 dígitos. Es el `id` con que la Alcaldía identifica la unidad '
  'en IMAU Flota. Se declara acá; `gps_posiciones.id_equipo` es lo que MANDÓ el '
  'proveedor y sirve para detectar un aparato cambiado de camión, no para reenviar.';

-- Se llena desde lo MEDIDO (la última posición de cada unidad), no a mano: un
-- IMEI tecleado es un IMEI que puede estar mal escrito y nadie lo notaría hasta
-- que la Alcaldía reclame que falta un camión.
update gps_equipos e
   set imei = (select p.id_equipo
                 from gps_posiciones p
                where p.cam = e.cam
                  and p.id_equipo ~ '^[0-9]{15}$'
                order by p.ts desc
                limit 1)
 where e.imei is null;

-- ── 2. Dónde va el cursor de cada unidad ────────────────────────────────────
create table if not exists gps_reenvio_estado (
  -- ⚠️ Sin llave foránea a `gps_equipos`: su primary key es `id_equipo` (la
  -- placa), no `cam`, y no se le cambia la forma a una tabla viva por esto. Lo
  -- que importa —que no se anote una unidad inventada— lo sostiene
  -- `gps_reenvio_anotar`, que revienta si no hay cursor, y los cursores nacen
  -- de `gps_equipos` y de ningún otro lado.
  cam                text primary key,
  enviado_hasta      timestamptz not null,
  ultima_corrida     timestamptz,
  ultimo_ok          timestamptz,
  ultimo_error       text,
  intentos_fallidos  integer not null default 0,
  enviadas_total     bigint  not null default 0
);

comment on table gps_reenvio_estado is
  'Hasta qué posición de cada unidad se le mandó a IMAU Flota. `enviado_hasta` NO '
  'avanza sobre un fallo: se detiene en el primer error y lo reintenta la corrida '
  'siguiente. `ultimo_ok` existe para que el SILENCIO no pase por normalidad: un '
  'reenvío caído se ve igual que todo en orden.';

-- El cursor arranca ahora (decisión 3). Las unidades sin IMEI también llevan
-- fila: así el cuadre puede decir «esta no se manda y por qué», en vez de que
-- falte y nadie sepa si es un olvido.
insert into gps_reenvio_estado (cam, enviado_hasta)
select cam, now() from gps_equipos
on conflict (cam) do nothing;

-- ── 3. El cuadre: cuántas había y cuántas salieron ──────────────────────────
create table if not exists gps_reenvio_dia (
  cam       text not null,          -- ver la nota de `gps_reenvio_estado`
  f         date not null,
  enviadas  integer not null default 0,
  fallidas  integer not null default 0,
  primary key (cam, f)
);

comment on table gps_reenvio_dia is
  'Contador por unidad y por día de lo que SALIÓ. Son ~10 filas al día: cuesta '
  'nada y es lo único que permite contestar «¿se le mandaron todas las posiciones '
  'del martes?» con un número en vez de una impresión.';

-- ── 4. Las tres preguntas que hay que poder contestar ───────────────────────

-- a) ¿Cuadra lo que hay con lo que salió, por unidad y por día?
create or replace function gps_reenvio_cuadre(p_desde date default (current_date - 7))
returns table (
  cam text, f date, imei text,
  posiciones bigint, enviadas integer, fallidas integer,
  faltan bigint, estado text
)
language sql stable security definer set search_path = public as $$
  with pos as (
    select p.cam, (p.ts at time zone 'America/Caracas')::date f, count(*) n
      from gps_posiciones p
     where (p.ts at time zone 'America/Caracas')::date >= p_desde
     group by 1, 2
  )
  select pos.cam, pos.f, e.imei,
         pos.n,
         coalesce(d.enviadas, 0),
         coalesce(d.fallidas, 0),
         pos.n - coalesce(d.enviadas, 0),
         case
           when e.imei is null                            then 'sin IMEI: no se manda'
           when coalesce(d.enviadas, 0) = 0               then 'nada salió'
           when pos.n - coalesce(d.enviadas, 0) = 0       then 'cuadra'
           when pos.n - coalesce(d.enviadas, 0) <= 2      then 'cuadra (en camino)'
           else 'FALTAN'
         end
    from pos
    join gps_equipos e on e.cam = pos.cam
    left join gps_reenvio_dia d on d.cam = pos.cam and d.f = pos.f
   order by pos.f desc, pos.cam
$$;

comment on function gps_reenvio_cuadre(date) is
  'El control de exactitud. «Faltan N» es la única forma de saber que a la Alcaldía '
  'le falta recorrido ANTES de que lo reclame. Hasta 2 de diferencia es normal: son '
  'las posiciones que entraron entre el conteo y la corrida.';

-- b) ¿Hay atraso ahora mismo?
create or replace function gps_reenvio_atraso()
returns table (cam text, pendientes bigint, atraso_min numeric, ultimo_ok timestamptz, ultimo_error text)
language sql stable security definer set search_path = public as $$
  select s.cam,
         (select count(*) from gps_posiciones p where p.cam = s.cam and p.ts > s.enviado_hasta),
         round(extract(epoch from (now() - s.enviado_hasta)) / 60.0, 1),
         s.ultimo_ok, s.ultimo_error
    from gps_reenvio_estado s
    join gps_equipos e on e.cam = s.cam
   where e.activo and e.imei is not null
   order by 2 desc
$$;

-- c) ¿Algún aparato cambió de camión? (decisión 4)
create or replace function gps_reenvio_imei_discrepante()
returns table (cam text, imei_declarado text, imei_que_llego text, desde timestamptz, posiciones bigint)
language sql stable security definer set search_path = public as $$
  select p.cam, e.imei, p.id_equipo, min(p.ts), count(*)
    from gps_posiciones p
    join gps_equipos e on e.cam = p.cam
   where e.imei is not null
     and p.id_equipo ~ '^[0-9]{15}$'
     and p.id_equipo <> e.imei
     and p.ts > now() - interval '7 days'
   group by 1, 2, 3
   order by 5 desc
$$;

comment on function gps_reenvio_imei_discrepante() is
  'Si devuelve filas, un aparato está reportando bajo otra unidad: el camión que '
  'la Alcaldía ve en el mapa NO es el que creemos. No se corrige solo a propósito.';

-- ── 4 bis. Anotar una corrida: el cursor y el contador, JUNTOS ──────────────
-- ⛔ VAN EN LA MISMA TRANSACCIÓN A PROPÓSITO. Si el cursor avanzara y el
-- contador del día no, el cuadre diría «faltan» para siempre sobre posiciones
-- que SÍ salieron: el control que existe para probar la exactitud pasaría a
-- desmentirla, y nadie podría distinguir un hueco real de un contador perdido.
create or replace function gps_reenvio_anotar(
  p_cam     text,
  p_hasta   timestamptz,          -- última que salió BIEN; null si no salió ninguna
  p_por_dia jsonb default '{}',   -- {"2026-10-21": 37}
  p_error   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record; n_dias int := 0; n_pos int := 0;
begin
  if not exists (select 1 from gps_reenvio_estado where cam = p_cam) then
    raise exception 'gps_reenvio_anotar: no hay cursor para %', p_cam;
  end if;

  update gps_reenvio_estado s
     set ultima_corrida    = now(),
         ultimo_error      = p_error,
         enviado_hasta     = coalesce(p_hasta, s.enviado_hasta),
         ultimo_ok         = case when p_hasta is not null then now() else s.ultimo_ok end,
         enviadas_total    = s.enviadas_total
                             + coalesce((select sum(v::int) from jsonb_each_text(p_por_dia) t(k, v)), 0),
         intentos_fallidos = case when p_error is null then 0 else s.intentos_fallidos + 1 end
   where s.cam = p_cam;

  for d in select k::date f, v::int n from jsonb_each_text(p_por_dia) t(k, v) loop
    insert into gps_reenvio_dia (cam, f, enviadas, fallidas)
    values (p_cam, d.f, d.n, case when p_error is null then 0 else 1 end)
    on conflict (cam, f) do update
      set enviadas = gps_reenvio_dia.enviadas + excluded.enviadas,
          fallidas = gps_reenvio_dia.fallidas + excluded.fallidas;
    n_dias := n_dias + 1;
    n_pos  := n_pos + d.n;
  end loop;

  return jsonb_build_object('dias', n_dias, 'posiciones', n_pos, 'hasta', p_hasta);
end $$;

comment on function gps_reenvio_anotar(text, timestamptz, jsonb, text) is
  'Una corrida del reenviador, anotada de una sola vez: el cursor avanza hasta lo '
  'que salió bien y el contador del día suma lo mismo. Revienta si no hay cursor: '
  'anotar envíos de una unidad que nadie declaró es inventar una fila.';

-- ── 5. Candados de lectura ──────────────────────────────────────────────────
-- Las escribe SOLO el reenviador (service_role): ninguna policy de insert,
-- update ni delete. Una evidencia que la oficina puede retocar no prueba nada.
alter table gps_reenvio_estado enable row level security;
alter table gps_reenvio_dia    enable row level security;

drop policy if exists gps_reenvio_estado_sel on gps_reenvio_estado;
create policy gps_reenvio_estado_sel on gps_reenvio_estado for select to authenticated
  using (app_rol() = any (array['superadmin','admin','operador','visualizador','directivo',
                               'auditor','revisor','operativo','mecanico','rrhh']));

drop policy if exists gps_reenvio_dia_sel on gps_reenvio_dia;
create policy gps_reenvio_dia_sel on gps_reenvio_dia for select to authenticated
  using (app_rol() = any (array['superadmin','admin','operador','visualizador','directivo',
                               'auditor','revisor','operativo','mecanico','rrhh']));

revoke all on function gps_reenvio_cuadre(date)          from anon;
revoke all on function gps_reenvio_atraso()              from anon;
revoke all on function gps_reenvio_imei_discrepante()    from anon;
-- Anotar envíos es escribir evidencia: solo el reenviador (service_role).
revoke all on function gps_reenvio_anotar(text, timestamptz, jsonb, text) from anon, authenticated;

-- ── 6. CONTROL POSITIVO: que la migración se pruebe sola ────────────────────
-- ⛔ Sin esto, «quedó instalado» es una impresión. Una aserción que revienta es
-- la única forma de que un error no se vaya en silencio.
-- [[norma-una-asercion-mal-escrita-acusa-al-producto]]
do $$
declare n_imei int; n_est int; n_cuadre int;
begin
  select count(*) into n_imei from gps_equipos where imei ~ '^[0-9]{15}$';
  if n_imei < 10 then
    raise exception 'CONTROL: se esperaban al menos 10 IMEI declarados y hay %. '
      'Sin IMEI no se puede reenviar nada.', n_imei;
  end if;

  select count(*) into n_est from gps_reenvio_estado;
  if n_est < 10 then
    raise exception 'CONTROL: faltan filas de cursor (hay %)', n_est;
  end if;

  -- El cuadre tiene que CONTESTAR, aunque todavía no haya salido nada.
  select count(*) into n_cuadre from gps_reenvio_cuadre(current_date - 2);
  if n_cuadre = 0 then
    raise exception 'CONTROL: gps_reenvio_cuadre() no devolvió ni una fila con '
      '2 días de posiciones en la base. El control no mide lo que dice medir.';
  end if;

  -- Y tiene que decir «nada salió», no «cuadra»: nada salió todavía.
  if not exists (select 1 from gps_reenvio_cuadre(current_date - 2)
                  where estado in ('nada salió', 'sin IMEI: no se manda')) then
    raise exception 'CONTROL: el cuadre dice que cuadra sin haberse mandado una '
      'sola posición. Un control que afirma lo que no comprobó es peor que ninguno.';
  end if;

  -- Y `gps_reenvio_anotar` tiene que NEGARSE con una unidad que no existe:
  -- anotar envíos de un camión que nadie declaró es fabricar evidencia.
  -- ⛔ Esto se prueba acá y no «cuando haga falta»: un candado que no se
  -- ejercita se estrena el día que tiene que funcionar.
  begin
    perform gps_reenvio_anotar('NO-EXISTE-XX', now(), '{}'::jsonb, null);
    raise exception 'CONTROL: gps_reenvio_anotar ACEPTÓ una unidad inexistente';
  exception
    when others then
      if position('no hay cursor' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'OK · % IMEI declarados · % cursores · el cuadre contesta · anotar se niega', n_imei, n_est;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
--  ⏳ LO QUE NO HACE ESTA MIGRACIÓN, A PROPÓSITO
--
--  · NO guarda la dirección de IMAU Flota. Va en `configuracion` y se carga
--    aparte, porque este archivo SÍ entra a un repo público.
--  · NO programa el cron. Quién decide cuándo empieza a salir es Máximo, y
--    antes la Alcaldía tiene que vincular los IMEI: Leonel avisó que una
--    unidad aparece en el mapa solo cuando ellos la vinculan.
--  · NO manda el histórico (decisión 3).
--  · NO avisa si el reenvío se cae. `gps_reenvio_atraso()` deja el dato listo;
--    quien tiene que mirarlo es el vigilante, y eso es la pieza siguiente.
--    ⛔ Mientras eso no exista, el reenvío puede estar caído sin que nadie se
--    entere — y es exactamente el escenario del «no estuve».
-- ════════════════════════════════════════════════════════════════════════════
