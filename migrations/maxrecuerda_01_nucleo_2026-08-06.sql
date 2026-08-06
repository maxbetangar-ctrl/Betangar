-- ============================================================================
-- MaxRecuerda — NÚCLEO
--
-- Un recordatorio es una promesa: «el 1 de cada mes a las 8, avísale a Gladys
-- que hay que pagar el seguro». La memoria de una persona no es un sistema; el
-- día que esa persona está de reposo, la promesa no existió.
--
-- ⛔ LO QUE ESTE MÓDULO **NO** HACE, A PROPÓSITO: no envía.
--    Calcula QUÉ toca AHORA y se lo entrega al buzón que la app anfitriona ya
--    tiene (`cola_mensajes`, `edu_cola_mensajes`, la que sea). Motivos:
--      · cada producto manda por SU número de WhatsApp, no por uno nuevo;
--      · la lista blanca que ya protege esa cola sigue protegiendo esto;
--      · si Wassenger se cae, el cálculo ya está hecho y guardado: cuando
--        vuelve, sale solo sin recalcular nada.
--    Una segunda boca de envío sería un segundo sitio donde equivocarse de
--    número — y el número es lo único que no se puede reponer.
--
-- ESTE ARCHIVO ES IDÉNTICO EN TODAS LAS BASES. Lo que cambia de una app a otra
-- son CUATRO ENCHUFES, que viven en `02_adaptador_*.sql`:
--      rec_directorio     (vista)  — de dónde salen las personas
--      rec_entregar()              — a qué cola se le entrega el mensaje
--      rec_quien_soy()             — quién es el que tiene la sesión abierta
--      rec_es_staff() / rec_puede_borrar() / rec_tenant_actual() / rec_zona()
--
-- Los enchufes se instalan aquí en versión TAPÓN: no rompen nada, pero no
-- hacen nada. Y `rec_diagnostico()` los delata en rojo. Es la lección del
-- 06/08 con la auditoría: una pieza que no puede trabajar tiene que gritarlo,
-- porque un canal caído se ve exactamente igual que todo en orden.
--
-- Idempotente. Se puede correr encima de sí mismo.
-- ============================================================================

-- ── 0) La ficha del módulo ──────────────────────────────────────────────────
-- Fila única. `marca` va vacía cuando la cola anfitriona YA pone su etiqueta
-- (Betangar lo hace: el worker antepone "♻️ Betangar:"). Ponerla aquí también
-- sacaría la marca dos veces.
create table if not exists public.rec_config (
  id            smallint primary key default 1 check (id = 1),
  marca         text not null default '',
  enlace_base   text not null default '',   -- dónde vive `recordar.html`
  activo        boolean not null default true,
  actualizado_at timestamptz not null default now()
);
insert into public.rec_config (id) values (1) on conflict (id) do nothing;

comment on column public.rec_config.enlace_base is
  'URL de recordar.html. Sin esto el mensaje sale sin el botón de «ya lo hice» '
  'y la confirmación solo se puede dar desde dentro de la app.';

-- ── 1) EL RECORDATORIO — la promesa ─────────────────────────────────────────
-- ⚠️ La hora se guarda como HORA DE PARED (`hora time`) + `zona`, NUNCA como
-- un instante suelto. «Todos los días a las 8» significa las 8 del negocio: si
-- se guardara el instante, un país que mueve el reloj empezaría a avisar a las
-- 7 en invierno sin que nadie tocara nada.
create table if not exists public.rec_recordatorios (
  id             bigint generated always as identity primary key,
  tenant         text,                     -- null = base de un solo negocio
  titulo         text not null check (length(btrim(titulo)) between 1 and 140),
  detalle        text,
  zona           text not null default 'America/Caracas',
  hora           time not null,

  patron         text not null check (patron in ('unica','diaria','semanal','mensual','anual')),
  cada           int  not null default 1 check (cada between 1 and 60),
  dias_semana    smallint[] not null default '{}',  -- 1=lunes … 7=domingo (isodow)
  dia_mes        smallint check (dia_mes between 0 and 31),  -- 0 = ÚLTIMO día del mes
  mes            smallint check (mes between 1 and 12),

  -- ⚠️ La importancia NO es un adorno: decide el color de la tarjeta, el orden
  -- de la campanita y el encabezado que llega al teléfono. Si todo pesa igual,
  -- nada pesa — y una lista donde todo se ve del mismo gris no se lee, se
  -- ignora. Tres niveles y no más: con cinco, todo el mundo pone el más alto.
  importancia    text not null default 'normal'
                 check (importancia in ('normal','importante','urgente')),

  desde          date not null,
  hasta          date,
  veces          int check (veces > 0),

  -- ⛔ Lo de ayer no se envía hoy. Si el latido estuvo caído, un recordatorio
  -- viejo no es un recordatorio tarde: es un recordatorio equivocado, y encima
  -- destruye la confianza en los que sí llegan a tiempo.
  -- Tope de 12 h, no más: es lo que la cola de la app aguanta antes de tirar el
  -- mensaje por su cuenta. Permitir aquí un plazo mayor que el de la cola sería
  -- prometer una entrega que otro ya descartó — y el módulo lo daría por vivo.
  vence_min      int not null default 360 check (vence_min between 5 and 720),

  confirmar      boolean not null default false,
  escalar_min    int check (escalar_min between 5 and 20160),

  activo         boolean not null default true,
  creado_por     text,
  creado_por_nombre text,
  creado_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),

  constraint rec_patron_coherente check (
    case patron
      when 'semanal' then coalesce(array_length(dias_semana, 1), 0) between 1 and 7
      when 'mensual' then dia_mes is not null
      when 'anual'   then dia_mes is not null and mes is not null
      else true
    end
  ),
  constraint rec_ventana_coherente check (hasta is null or hasta >= desde),
  -- Escalar sin pedir confirmación no significa nada: no hay nada que esperar.
  constraint rec_escalada_necesita_confirmar check (escalar_min is null or confirmar)
);

comment on column public.rec_recordatorios.dia_mes is
  '0 = último día del mes. Y un 31 en un mes de 30 cae en el 30: «pagar el 31» '
  'tiene que dispararse en febrero, no saltarse el mes.';

create index if not exists rec_rec_activo_idx
  on public.rec_recordatorios (activo, tenant) where activo;

-- ── 2) A QUIÉN ──────────────────────────────────────────────────────────────
-- `persona_id` apunta al directorio de la app anfitriona (el empleado). El
-- teléfono se copia igual: si mañana la persona cambia de número, el
-- recordatorio viejo tiene que seguir sabiendo a qué número se mandó.
create table if not exists public.rec_destinatarios (
  id              bigint generated always as identity primary key,
  recordatorio_id bigint not null references public.rec_recordatorios(id) on delete cascade,
  persona_id      text,
  nombre          text not null,
  telefono        text not null,
  tel_canon       text generated always as
                  (right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10)) stored,
  papel           text not null default 'destino' check (papel in ('destino','escalada')),
  creado_at       timestamptz not null default now(),
  unique (recordatorio_id, tel_canon, papel)
);

create index if not exists rec_dest_rec_idx on public.rec_destinatarios (recordatorio_id);

-- Destinos de fuera del directorio (el contador, el proveedor del seguro). Los
-- carga un admin a mano y quedan auditables, igual que la lista blanca del
-- WhatsApp. Sin esto habría que meter en la nómina a gente que no trabaja aquí.
create table if not exists public.rec_destinos_extra (
  tel_canon text primary key,
  nombre    text not null,
  nota      text,
  creado_por text,
  creado_at timestamptz not null default now()
);

-- ── 3) EL LIBRO — cada ocurrencia, una fila ─────────────────────────────────
-- ⚠️ `unique (recordatorio_id, momento)` es la llave de «una sola vez». Sin
-- ella, dos latidos simultáneos mandan el mismo aviso dos veces y quien lo
-- recibe deja de creerle al sistema.
create table if not exists public.rec_disparos (
  id              bigint generated always as identity primary key,
  recordatorio_id bigint not null references public.rec_recordatorios(id) on delete cascade,
  momento         timestamptz not null,
  momento_local   text not null,           -- "2026-08-10 15:00" en la zona del negocio
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','procesando','enviado','vencido','cancelado','sin_destino')),
  procesado_at    timestamptz,
  motivo          text,
  creado_at       timestamptz not null default now(),
  unique (recordatorio_id, momento)
);

create index if not exists rec_disp_pendientes_idx
  on public.rec_disparos (momento) where estado = 'pendiente';

-- ── 4) CADA AVISO A CADA PERSONA ────────────────────────────────────────────
-- Aquí es donde vive la respuesta a «¿se hizo?». Un recordatorio con tres
-- destinatarios son tres entregas: que uno confirme no dice nada de los otros.
create table if not exists public.rec_entregas (
  id              bigint generated always as identity primary key,
  disparo_id      bigint not null references public.rec_disparos(id) on delete cascade,
  recordatorio_id bigint not null references public.rec_recordatorios(id) on delete cascade,
  persona_id      text,
  nombre          text,
  telefono        text,
  papel           text not null default 'destino',
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','encolado','sin_canal','visto','hecho','vencido','escalado')),
  cola_ref        text,
  token           text not null unique,
  visto_at        timestamptz,
  hecho_at        timestamptz,
  hecho_por       text,
  hecho_via       text,
  escalado_at     timestamptz,
  error_msg       text,
  creado_at       timestamptz not null default now()
);

create index if not exists rec_ent_persona_idx
  on public.rec_entregas (persona_id, estado);
create index if not exists rec_ent_disparo_idx
  on public.rec_entregas (disparo_id);
-- Para la escalada: buscar lo que sigue sin confirmar sin barrer la tabla.
create index if not exists rec_ent_sin_confirmar_idx
  on public.rec_entregas (recordatorio_id, estado)
  where estado in ('encolado','visto','sin_canal');

-- ============================================================================
-- ENCHUFES — versión TAPÓN.
-- El adaptador de cada app los reemplaza con `create or replace`. La marca
-- MAXRECUERDA_TAPON es la que permite a `rec_diagnostico()` distinguir «esto
-- está conectado» de «esto todavía es el tapón de fábrica».
-- ============================================================================

-- La zona del NEGOCIO. Sale de su fuente (la configuración de la app), no se
-- adivina: un dato que se adivina es un dato que un día se adivina mal.
create or replace function public.rec_zona() returns text
language sql stable set search_path to 'public', 'pg_temp' as $$
  select 'America/Caracas'::text;  -- MAXRECUERDA_TAPON
$$;

-- Qué negocio es «el de ahora» en una base multi-empresa. null = base de una sola.
create or replace function public.rec_tenant_actual() returns text
language sql stable set search_path to 'public', 'pg_temp' as $$
  select null::text;  -- MAXRECUERDA_TAPON
$$;

-- ⚠️ `authenticated` NO es «el personal». Tener sesión no dice quién eres.
-- Por eso esto arranca en false: sin adaptador, nadie ve ni crea nada.
create or replace function public.rec_es_staff() returns boolean
language sql stable set search_path to 'public', 'pg_temp' as $$
  select false;  -- MAXRECUERDA_TAPON
$$;

create or replace function public.rec_puede_borrar() returns boolean
language sql stable set search_path to 'public', 'pg_temp' as $$
  select false;  -- MAXRECUERDA_TAPON
$$;

-- Quién tiene la sesión abierta, en términos del DIRECTORIO (no de auth).
-- Es lo que hace que la campanita enseñe lo mío y no lo de todos.
create or replace function public.rec_quien_soy()
returns table (persona_id text, nombre text, telefono text)
language sql stable set search_path to 'public', 'pg_temp' as $$
  select null::text, null::text, null::text where false;  -- MAXRECUERDA_TAPON
$$;

-- El directorio: las personas del software anfitrión. Es la vista que hace que
-- el usuario ELIJA a un trabajador en vez de escribir un teléfono de memoria.
drop view if exists public.rec_directorio;
create view public.rec_directorio as
  -- MAXRECUERDA_TAPON
  select null::text as persona_id, null::text as nombre, null::text as telefono,
         null::text as rol, null::text as tenant, false as activo
  where false;

-- La boca: entrega el mensaje a la cola de la app. Devuelve una referencia
-- (el id de la fila encolada) o null si no se pudo.
create or replace function public.rec_entregar(p_telefono text, p_mensaje text, p_ctx jsonb)
returns text
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  -- MAXRECUERDA_TAPON
  return null;
end;
$$;

-- ⛔ Solo el motor la ejecuta. Si `authenticated` pudiera llamarla, cualquiera
-- con sesión tendría un atajo para escribirle a quien quisiera desde el número
-- del negocio, saltándose la lista blanca de la cola.
revoke all on function public.rec_entregar(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rec_entregar(text, text, jsonb) to service_role;

-- ============================================================================
-- ¿A QUIÉN SE LE PUEDE ESCRIBIR — dos niveles
-- El primero al guardar (para que el error se vea en pantalla, no en un log) y
-- el segundo al enviar (porque entre guardar y enviar pueden pasar meses).
-- ============================================================================
create or replace function public.rec_tel_canon(p_tel text) returns text
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 10);
$$;

create or replace function public.rec_destino_ok(p_tel text) returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select case when public.rec_tel_canon(p_tel) = '' then false else
    exists (select 1 from public.rec_directorio d
             where public.rec_tel_canon(d.telefono) = public.rec_tel_canon(p_tel))
    or
    exists (select 1 from public.rec_destinos_extra x
             where x.tel_canon = public.rec_tel_canon(p_tel))
  end;
$$;
grant execute on function public.rec_destino_ok(text) to authenticated, service_role;

create or replace function public.rec_guard_destino() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if public.rec_tel_canon(new.telefono) = '' then
    raise exception 'El teléfono de "%" no sirve para WhatsApp.', new.nombre
      using errcode = '23514';
  end if;
  if not public.rec_destino_ok(new.telefono) then
    raise exception 'A % (%) no se le puede escribir: no está en el directorio ni en los destinos autorizados. Agrégalo primero.',
      new.nombre, new.telefono using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rec_dest_guard on public.rec_destinatarios;
create trigger rec_dest_guard before insert or update of telefono
  on public.rec_destinatarios for each row execute function public.rec_guard_destino();

-- ============================================================================
-- EL MOTOR DE RECURRENCIA
--
-- Se calcula en el ESPACIO DE FECHAS LOCALES y solo al final se convierte a
-- instante con `at time zone`. Postgres hace ahí el trabajo sucio del horario
-- de verano; hacerlo al revés (sumar 24 horas a un instante) rompe el día que
-- el reloj se mueve, y rompe en silencio.
-- ============================================================================
create or replace function public.rec_proxima(p_rec_id bigint, p_despues timestamptz)
returns timestamptz
language plpgsql stable set search_path to 'public', 'pg_temp' as $$
declare
  r        public.rec_recordatorios%rowtype;
  d        date;
  tope     date;
  cand     timestamptz;
  vueltas  int := 0;
  -- ⛔ El CASE va a una variable y NO dentro del `if`. PL/pgSQL lee la
  -- condición de un `IF` hasta el PRIMER `THEN` que encuentra — y un CASE
  -- lleva THEN adentro, así que se comía la mitad de la expresión y el
  -- parser moría con «syntax error at end of input». Una asignación, en
  -- cambio, se lee hasta el `;`.
  coincide boolean;
begin
  select * into r from public.rec_recordatorios where id = p_rec_id;
  if not found or not r.activo then return null; end if;

  -- El día local desde el que empezamos a buscar. Nunca antes de `desde`.
  d := greatest(r.desde, (p_despues at time zone r.zona)::date);
  tope := coalesce(r.hasta, d + 3660);  -- diez años de búsqueda es de sobra

  while d <= tope and vueltas < 4000 loop
    vueltas := vueltas + 1;

    coincide := case r.patron
         when 'unica'   then d = r.desde
         when 'diaria'  then (d - r.desde) % r.cada = 0
         when 'semanal' then extract(isodow from d)::smallint = any (r.dias_semana)
                             and (floor((d - date_trunc('week', r.desde::timestamp)::date) / 7)::int) % r.cada = 0
         when 'mensual' then
           -- ⚠️ El día 31 en un mes de 30 cae en el 30, y el 0 significa
           -- «último». «Pagar el 31» tiene que sonar en febrero.
           ((extract(year from d) - extract(year from r.desde)) * 12
            + (extract(month from d) - extract(month from r.desde)))::int % r.cada = 0
           and extract(day from d)::int = (
             select case when r.dia_mes = 0 then u
                         else least(r.dia_mes::int, u) end
             from (select extract(day from (date_trunc('month', d::timestamp)
                          + interval '1 month - 1 day'))::int as u) z)
         when 'anual'   then
           (extract(year from d) - extract(year from r.desde))::int % r.cada = 0
           and extract(month from d)::int = r.mes
           and extract(day from d)::int = (
             select case when r.dia_mes = 0 then u
                         else least(r.dia_mes::int, u) end
             from (select extract(day from (date_trunc('month', d::timestamp)
                          + interval '1 month - 1 day'))::int as u) z)
         else false
       end;

    if coincide then
      cand := (d::timestamp + r.hora) at time zone r.zona;
      if cand > p_despues then return cand; end if;
    end if;

    -- «Única» no tiene segunda oportunidad: si su día ya pasó, se acabó.
    if r.patron = 'unica' and d >= r.desde then return null; end if;
    d := d + 1;
  end loop;

  return null;
end;
$$;

comment on function public.rec_proxima(bigint, timestamptz) is
  'El siguiente momento de un recordatorio DESPUÉS del instante dado. Trabaja en '
  'fechas locales y convierte al final con `at time zone`: así el horario de verano '
  'lo resuelve Postgres y no un cálculo a mano que falla en silencio.';

-- ── Materializar el siguiente disparo ───────────────────────────────────────
-- Se mantiene UNO pendiente por recordatorio, no un calendario entero. Un
-- calendario materializado a un año se queda viejo en cuanto alguien edita la
-- hora, y entonces el sistema avisa a la hora que ya no es.
create or replace function public.rec_programar(p_rec_id bigint)
returns timestamptz
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  r     public.rec_recordatorios%rowtype;
  ultimo timestamptz;
  n_ya  int;
  prox  timestamptz;
begin
  select * into r from public.rec_recordatorios where id = p_rec_id;
  if not found then return null; end if;

  -- Si está apagado o pausado, no debe quedar nada esperando.
  if not r.activo then
    update public.rec_disparos set estado = 'cancelado', motivo = 'recordatorio apagado'
     where recordatorio_id = p_rec_id and estado = 'pendiente';
    return null;
  end if;

  -- ¿Ya tiene uno esperando? Entonces no hay nada que hacer.
  if exists (select 1 from public.rec_disparos
              where recordatorio_id = p_rec_id and estado = 'pendiente') then
    return null;
  end if;

  select count(*) into n_ya from public.rec_disparos
   where recordatorio_id = p_rec_id and estado in ('enviado','vencido','sin_destino');
  if r.veces is not null and n_ya >= r.veces then
    update public.rec_recordatorios set activo = false, actualizado_at = now() where id = p_rec_id;
    return null;
  end if;

  select max(momento) into ultimo from public.rec_disparos where recordatorio_id = p_rec_id;
  prox := public.rec_proxima(p_rec_id, greatest(coalesce(ultimo, '-infinity'::timestamptz), now() - interval '1 minute'));

  if prox is null then
    -- Se le acabó la cuerda: se apaga solo. Un recordatorio vencido que sigue
    -- «activo» en la lista es ruido que nadie limpia nunca.
    update public.rec_recordatorios set activo = false, actualizado_at = now() where id = p_rec_id;
    return null;
  end if;

  insert into public.rec_disparos (recordatorio_id, momento, momento_local)
  values (p_rec_id, prox, to_char(prox at time zone r.zona, 'YYYY-MM-DD HH24:MI'))
  on conflict (recordatorio_id, momento) do nothing;

  return prox;
end;
$$;

-- ============================================================================
-- EL TEXTO — lo que la persona lee en el teléfono y en la pantalla
-- ============================================================================
create or replace function public.rec_en_palabras(p_rec_id bigint) returns text
language plpgsql stable set search_path to 'public', 'pg_temp' as $$
declare
  r    public.rec_recordatorios%rowtype;
  dias constant text[] := array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  s    text;
  ds   text;
  arr  text[];
begin
  select * into r from public.rec_recordatorios where id = p_rec_id;
  if not found then return ''; end if;

  -- «lunes y jueves», no «lunes, jueves». Una lista con comas hasta el final se
  -- lee como un volcado de sistema; la frase tiene que sonar a persona, porque
  -- es lo que el dueño lee para comprobar que quedó como quería.
  if r.patron = 'semanal' then
    select array_agg(dias[x] order by x) into arr from unnest(r.dias_semana) as x;
    if coalesce(array_length(arr, 1), 0) <= 1 then
      ds := coalesce(arr[1], '');
    else
      ds := array_to_string(arr[1:array_length(arr, 1) - 1], ', ')
            || ' y ' || arr[array_length(arr, 1)];
    end if;
  end if;

  s := case r.patron
    when 'unica'   then 'Una sola vez el ' || to_char(r.desde, 'DD/MM/YYYY')
    when 'diaria'  then case when r.cada = 1 then 'Todos los días'
                             else 'Cada ' || r.cada || ' días' end
    when 'semanal' then (case when r.cada = 1 then 'Todas las semanas'
                              else 'Cada ' || r.cada || ' semanas' end)
                        || ' los ' || ds
    when 'mensual' then (case when r.cada = 1 then 'Todos los meses'
                              else 'Cada ' || r.cada || ' meses' end)
                        || ' el ' || case when r.dia_mes = 0 then 'último día'
                                          else 'día ' || r.dia_mes end
    when 'anual'   then (case when r.cada = 1 then 'Todos los años'
                              else 'Cada ' || r.cada || ' años' end)
                        || ' el ' || case when r.dia_mes = 0 then 'último día de '
                                          else r.dia_mes || ' de ' end
                        || to_char(make_date(2000, r.mes, 1), 'TMMonth')
    else '' end;

  s := s || ' a las ' || to_char(r.hora, 'HH24:MI');

  if r.patron <> 'unica' then
    s := s || ', desde el ' || to_char(r.desde, 'DD/MM/YYYY');
    if r.hasta is not null then
      s := s || ' hasta el ' || to_char(r.hasta, 'DD/MM/YYYY');
    elsif r.veces is not null then
      s := s || ', ' || r.veces || ' veces';
    else
      s := s || ', hasta que lo apagues';
    end if;
  end if;
  return s;
end;
$$;
grant execute on function public.rec_en_palabras(bigint) to authenticated, service_role;

create or replace function public.rec_mensaje(p_entrega_id bigint) returns text
language plpgsql stable set search_path to 'public', 'pg_temp' as $$
declare
  e     public.rec_entregas%rowtype;
  r     public.rec_recordatorios%rowtype;
  disp  public.rec_disparos%rowtype;
  cfg   public.rec_config%rowtype;
  dias  constant text[] := array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  t     text;
  fecha date;
begin
  select * into e from public.rec_entregas where id = p_entrega_id;
  select * into r from public.rec_recordatorios where id = e.recordatorio_id;
  select * into disp from public.rec_disparos where id = e.disparo_id;
  select * into cfg from public.rec_config where id = 1;

  fecha := left(disp.momento_local, 10)::date;

  if e.papel = 'escalada' then
    t := '⚠️ SIN CONFIRMAR' || E'\n'
      || '*' || r.titulo || '*' || E'\n'
      || 'Estaba para el ' || to_char(fecha, 'DD/MM') || ' a las '
      || right(disp.momento_local, 5) || ' y nadie ha dicho que se hizo.';
  else
    -- El encabezado lo pone la IMPORTANCIA. Quien recibe veinte avisos a la
    -- semana tiene que poder distinguir en el primer renglón el que no puede
    -- esperar del que sí.
    t := case r.importancia
           when 'urgente'    then '🔴 URGENTE'
           when 'importante' then '🟠 Importante'
           else                   '🔔 Recordatorio' end || E'\n'
      || '*' || r.titulo || '*' || E'\n'
      || initcap(dias[extract(isodow from fecha)::int]) || ' '
      || to_char(fecha, 'DD/MM') || ' · ' || right(disp.momento_local, 5);
  end if;

  if coalesce(btrim(r.detalle), '') <> '' then
    t := t || E'\n\n' || r.detalle;
  end if;

  if coalesce(r.creado_por_nombre, '') <> '' then
    t := t || E'\n\n— lo programó ' || r.creado_por_nombre;
  end if;

  -- El botón de «ya lo hice». Sin `enlace_base` el mensaje sale igual: se
  -- confirma desde dentro de la app. Lo que no puede pasar es que la falta del
  -- enlace impida el aviso.
  if r.confirmar and coalesce(cfg.enlace_base, '') <> '' and e.papel = 'destino' then
    t := t || E'\n\n✅ Ya lo hice: ' || rtrim(cfg.enlace_base, '/') || '?t=' || e.token;
  end if;

  if coalesce(cfg.marca, '') <> '' then
    t := '*' || cfg.marca || '*' || E'\n\n' || t;
  end if;

  return t;
end;
$$;

-- ============================================================================
-- EL LATIDO — lo único que corre solo
-- ============================================================================
create or replace function public.rec_tick()
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  d          public.rec_disparos%rowtype;
  r          public.rec_recordatorios%rowtype;
  dst        record;
  ent        public.rec_entregas%rowtype;
  aviso      public.rec_entregas%rowtype;   -- el de la escalada; NO se reutiliza `ent`
  rid        bigint;
  ref        text;
  n_env      int := 0;
  n_venc     int := 0;
  n_esc      int := 0;
  n_prog     int := 0;
  n_sin      int := 0;
  hubo_dest  boolean;
begin
  if not (select activo from public.rec_config where id = 1) then
    return jsonb_build_object('apagado', true);
  end if;

  -- ── 1) Lo que ya no debe salir ────────────────────────────────────────────
  -- Antes de mandar nada. Si el latido estuvo caído dos días, el aviso de
  -- anteayer NO puede salir hoy — y tiene que quedar el rastro de que no salió,
  -- porque un recordatorio que se perdió en silencio es peor que uno que no se
  -- programó nunca.
  for d in
    select ds.* from public.rec_disparos ds
      join public.rec_recordatorios rr on rr.id = ds.recordatorio_id
     where ds.estado = 'pendiente'
       and ds.momento < now() - make_interval(mins => rr.vence_min)
  loop
    update public.rec_disparos
       set estado = 'vencido', procesado_at = now(),
           motivo = 'el latido no corrió a tiempo'
     where id = d.id and estado = 'pendiente';
    n_venc := n_venc + 1;
    perform public.rec_programar(d.recordatorio_id);
  end loop;

  -- ── 2) Lo que toca ahora ──────────────────────────────────────────────────
  for d in
    select * from public.rec_disparos
     where estado = 'pendiente' and momento <= now()
     order by momento limit 200
  loop
    -- Reclamo atómico: si dos latidos se cruzan, solo uno se lo lleva.
    update public.rec_disparos set estado = 'procesando'
     where id = d.id and estado = 'pendiente';
    if not found then continue; end if;

    select * into r from public.rec_recordatorios where id = d.recordatorio_id;
    hubo_dest := false;

    for dst in
      select * from public.rec_destinatarios
       where recordatorio_id = d.recordatorio_id and papel = 'destino'
    loop
      hubo_dest := true;
      insert into public.rec_entregas
        (disparo_id, recordatorio_id, persona_id, nombre, telefono, papel, token)
      values (d.id, d.recordatorio_id, dst.persona_id, dst.nombre, dst.telefono, 'destino',
              replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
      returning * into ent;

      -- Segundo nivel del candado: entre guardar y enviar pueden haber pasado
      -- meses, y en el medio a esa persona la pudieron dar de baja.
      if not public.rec_destino_ok(dst.telefono) then
        update public.rec_entregas
           set estado = 'sin_canal', error_msg = 'el destino ya no está autorizado'
         where id = ent.id;
        n_sin := n_sin + 1;
        continue;
      end if;

      begin
        ref := public.rec_entregar(dst.telefono, public.rec_mensaje(ent.id),
                 jsonb_build_object('tipo', 'recordatorio', 'recordatorio_id', d.recordatorio_id,
                                    'entrega_id', ent.id, 'ref', 'rec:' || ent.id));
      exception when others then
        ref := null;
        update public.rec_entregas set error_msg = left(sqlerrm, 300) where id = ent.id;
      end;

      if ref is null then
        -- ⚠️ No se pierde: queda 'sin_canal' y SIGUE saliendo en la campanita.
        -- Por eso el aviso vive en dos sitios: si el WhatsApp falla, el
        -- recordatorio no desaparece, solo se queda dentro de la app.
        update public.rec_entregas
           set estado = 'sin_canal',
               error_msg = coalesce(error_msg, 'la cola de la app no aceptó el mensaje')
         where id = ent.id;
        n_sin := n_sin + 1;
      else
        update public.rec_entregas set estado = 'encolado', cola_ref = ref where id = ent.id;
        n_env := n_env + 1;
      end if;
    end loop;

    update public.rec_disparos
       set estado = case when hubo_dest then 'enviado' else 'sin_destino' end,
           procesado_at = now(),
           motivo = case when hubo_dest then null else 'el recordatorio no tiene a quién avisarle' end
     where id = d.id;

    perform public.rec_programar(d.recordatorio_id);
  end loop;

  -- ── 3) La escalada ────────────────────────────────────────────────────────
  -- Nadie dijo que se hizo. Se le avisa al que tenga que enterarse — una vez.
  for ent in
    select e.* from public.rec_entregas e
      join public.rec_recordatorios rr on rr.id = e.recordatorio_id
      join public.rec_disparos ds on ds.id = e.disparo_id
     where rr.confirmar and rr.escalar_min is not null
       and e.papel = 'destino'
       and e.estado in ('encolado','visto','sin_canal')
       and now() > ds.momento + make_interval(mins => rr.escalar_min)
     limit 100
  loop
    update public.rec_entregas set estado = 'escalado', escalado_at = now()
     where id = ent.id and estado in ('encolado','visto','sin_canal');
    if not found then continue; end if;

    for dst in
      select * from public.rec_destinatarios
       where recordatorio_id = ent.recordatorio_id and papel = 'escalada'
    loop
      -- ⚠️ En variable propia. Escribir sobre `ent` (la del bucle) hacía que el
      -- SEGUNDO jefe de la escalada recibiera el mensaje del primero.
      insert into public.rec_entregas
        (disparo_id, recordatorio_id, persona_id, nombre, telefono, papel, token)
      values (ent.disparo_id, ent.recordatorio_id, dst.persona_id, dst.nombre, dst.telefono, 'escalada',
              replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
      returning * into aviso;
      if public.rec_destino_ok(dst.telefono) then
        ref := public.rec_entregar(dst.telefono, public.rec_mensaje(aviso.id),
                 jsonb_build_object('tipo', 'recordatorio_escalada', 'entrega_id', aviso.id,
                                    'ref', 'rec:' || aviso.id));
        update public.rec_entregas
           set estado = case when ref is null then 'sin_canal' else 'encolado' end, cola_ref = ref
         where id = aviso.id;
      else
        update public.rec_entregas set estado = 'sin_canal',
               error_msg = 'el destino de la escalada no está autorizado' where id = aviso.id;
      end if;
      n_esc := n_esc + 1;
    end loop;
  end loop;

  -- ── 4) Curarse solo ───────────────────────────────────────────────────────
  -- Cualquier recordatorio activo que se haya quedado sin siguiente disparo
  -- (porque se editó, porque falló una corrida) vuelve a tener uno. Sin esto,
  -- un recordatorio puede quedarse mudo para siempre y nadie se entera hasta
  -- que hace falta.
  for rid in select rr.id from public.rec_recordatorios rr
              where rr.activo
                and not exists (select 1 from public.rec_disparos ds
                                 where ds.recordatorio_id = rr.id and ds.estado = 'pendiente')
  loop
    if public.rec_programar(rid) is not null then n_prog := n_prog + 1; end if;
  end loop;

  return jsonb_build_object(
    'enviados', n_env, 'vencidos', n_venc, 'escalados', n_esc,
    'sin_canal', n_sin, 'reprogramados', n_prog, 'cuando', now());
end;
$$;

revoke all on function public.rec_tick() from public, anon, authenticated;
grant execute on function public.rec_tick() to service_role;

-- ============================================================================
-- LO QUE USA LA PANTALLA
-- ============================================================================

-- La campanita: lo mío y solo lo mío. SECURITY DEFINER a propósito — así el
-- trabajador ve SU recordatorio sin darle lectura sobre la tabla entera.
create or replace function public.rec_mis_pendientes()
returns table (entrega_id bigint, titulo text, detalle text, cuando text,
               confirmar boolean, estado text, papel text, importancia text,
               sin_whatsapp boolean, vence_at timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select e.id, r.titulo, r.detalle, d.momento_local, r.confirmar, e.estado, e.papel,
         r.importancia, e.estado = 'sin_canal',
         d.momento + make_interval(mins => r.vence_min)
    from public.rec_entregas e
    join public.rec_recordatorios r on r.id = e.recordatorio_id
    join public.rec_disparos d on d.id = e.disparo_id
   where e.estado in ('encolado','visto','sin_canal','escalado')
     and e.persona_id is not null
     and e.persona_id in (select q.persona_id from public.rec_quien_soy() q)
   -- Lo urgente arriba, y dentro de cada nivel lo más reciente. Ordenar solo
   -- por fecha entierra un «urgente» de ayer debajo de tres avisos de rutina.
   order by case r.importancia when 'urgente' then 0 when 'importante' then 1 else 2 end,
            d.momento desc
   limit 50;
$$;
grant execute on function public.rec_mis_pendientes() to authenticated;

-- «Ya lo hice», desde dentro de la app.
create or replace function public.rec_marcar_hecho(p_entrega_id bigint)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare yo record; e public.rec_entregas%rowtype;
begin
  select * into yo from public.rec_quien_soy() limit 1;
  select * into e from public.rec_entregas where id = p_entrega_id;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no existe'); end if;

  -- Solo el dueño del recordatorio o alguien del personal. Que un tercero
  -- pueda cerrar el pendiente de otro convierte el control en decorado.
  if not (public.rec_es_staff() or (yo.persona_id is not null and yo.persona_id = e.persona_id)) then
    return jsonb_build_object('ok', false, 'motivo', 'no es tuyo');
  end if;

  update public.rec_entregas
     set estado = 'hecho', hecho_at = now(),
         hecho_por = coalesce(yo.nombre, 'desde la app'), hecho_via = 'app'
   where id = p_entrega_id and estado <> 'hecho';

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.rec_marcar_hecho(bigint) to authenticated;

-- «Ya lo hice», desde el enlace del WhatsApp. El token ES la credencial: por
-- eso son 64 hex de `gen_random_uuid()` y no un id correlativo — con un id,
-- cualquiera cerraría los pendientes de todo el mundo probando números.
create or replace function public.rec_confirmar_por_token(p_token text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare e public.rec_entregas%rowtype; r public.rec_recordatorios%rowtype;
begin
  if coalesce(length(p_token), 0) < 32 then
    return jsonb_build_object('ok', false, 'motivo', 'enlace inválido');
  end if;
  select * into e from public.rec_entregas where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'enlace inválido'); end if;
  select * into r from public.rec_recordatorios where id = e.recordatorio_id;

  if e.estado <> 'hecho' then
    update public.rec_entregas
       set estado = 'hecho', hecho_at = now(),
           hecho_por = coalesce(e.nombre, 'por el enlace'), hecho_via = 'enlace'
     where id = e.id;
  end if;

  return jsonb_build_object('ok', true, 'titulo', r.titulo, 'nombre', e.nombre,
                            'ya_estaba', e.estado = 'hecho');
end;
$$;
revoke all on function public.rec_confirmar_por_token(text) from public;
grant execute on function public.rec_confirmar_por_token(text) to anon, authenticated;

-- Marcar como visto (lo llama la campanita al abrirse). No es lo mismo que
-- hecho, y mezclarlos sería mentir en el informe.
create or replace function public.rec_marcar_visto(p_entrega_id bigint) returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare yo record;
begin
  select * into yo from public.rec_quien_soy() limit 1;
  update public.rec_entregas set estado = 'visto', visto_at = now()
   where id = p_entrega_id and estado = 'encolado'
     and (public.rec_es_staff() or persona_id = yo.persona_id);
  return found;
end;
$$;
grant execute on function public.rec_marcar_visto(bigint) to authenticated;

-- Guardar (crear o editar) en UN viaje: la promesa y a quién, o ninguna de las
-- dos. Guardar el recordatorio y perder los destinatarios deja una promesa que
-- no le llega a nadie — y en pantalla se ve perfecta.
create or replace function public.rec_guardar(p jsonb)
returns jsonb
language plpgsql set search_path to 'public', 'pg_temp' as $$
declare
  id_r  bigint := nullif(p->>'id', '')::bigint;
  yo    record;
  dest  jsonb;
begin
  if not public.rec_es_staff() then
    raise exception 'No tienes permiso para programar recordatorios.' using errcode = '42501';
  end if;
  select * into yo from public.rec_quien_soy() limit 1;

  if id_r is null then
    insert into public.rec_recordatorios
      (tenant, titulo, detalle, zona, hora, patron, cada, dias_semana, dia_mes, mes,
       importancia, desde, hasta, veces, vence_min, confirmar, escalar_min, activo,
       creado_por, creado_por_nombre)
    values (
      public.rec_tenant_actual(),
      p->>'titulo', nullif(p->>'detalle', ''), coalesce(nullif(p->>'zona',''), public.rec_zona()),
      (p->>'hora')::time, p->>'patron', coalesce((p->>'cada')::int, 1),
      coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(coalesce(p->'dias_semana','[]'::jsonb)) x), '{}'),
      nullif(p->>'dia_mes','')::smallint, nullif(p->>'mes','')::smallint,
      coalesce(nullif(p->>'importancia',''), 'normal'),
      (p->>'desde')::date, nullif(p->>'hasta','')::date, nullif(p->>'veces','')::int,
      coalesce(nullif(p->>'vence_min','')::int, 360),
      coalesce((p->>'confirmar')::boolean, false), nullif(p->>'escalar_min','')::int,
      coalesce((p->>'activo')::boolean, true),
      yo.persona_id, yo.nombre)
    returning id into id_r;
  else
    update public.rec_recordatorios set
      titulo = p->>'titulo', detalle = nullif(p->>'detalle',''),
      zona = coalesce(nullif(p->>'zona',''), zona),
      hora = (p->>'hora')::time, patron = p->>'patron', cada = coalesce((p->>'cada')::int, 1),
      dias_semana = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(coalesce(p->'dias_semana','[]'::jsonb)) x), '{}'),
      dia_mes = nullif(p->>'dia_mes','')::smallint, mes = nullif(p->>'mes','')::smallint,
      importancia = coalesce(nullif(p->>'importancia',''), importancia),
      desde = (p->>'desde')::date, hasta = nullif(p->>'hasta','')::date,
      veces = nullif(p->>'veces','')::int,
      vence_min = coalesce(nullif(p->>'vence_min','')::int, vence_min),
      confirmar = coalesce((p->>'confirmar')::boolean, false),
      escalar_min = nullif(p->>'escalar_min','')::int,
      activo = coalesce((p->>'activo')::boolean, true),
      actualizado_at = now()
    where id = id_r;
    if not found then raise exception 'Ese recordatorio ya no existe.'; end if;

    -- Al editar, lo que todavía no salió se recalcula. Si no, se cambia la hora
    -- en pantalla y el aviso sigue sonando a la vieja.
    delete from public.rec_disparos where recordatorio_id = id_r and estado = 'pendiente';
  end if;

  delete from public.rec_destinatarios where recordatorio_id = id_r;
  for dest in select * from jsonb_array_elements(coalesce(p->'destinatarios', '[]'::jsonb)) loop
    insert into public.rec_destinatarios (recordatorio_id, persona_id, nombre, telefono, papel)
    values (id_r, nullif(dest->>'persona_id',''), dest->>'nombre', dest->>'telefono',
            coalesce(nullif(dest->>'papel',''), 'destino'));
  end loop;

  perform public.rec_programar(id_r);

  return jsonb_build_object('ok', true, 'id', id_r,
    'en_palabras', public.rec_en_palabras(id_r),
    'proximo', (select to_char(momento at time zone public.rec_zona(), 'DD/MM/YYYY HH24:MI')
                  from public.rec_disparos
                 where recordatorio_id = id_r and estado = 'pendiente' limit 1));
end;
$$;
grant execute on function public.rec_guardar(jsonb) to authenticated;

-- Qué viene. Para la pantalla de «próximos días» y para el informe mensual.
create or replace function public.rec_agenda(p_dias int default 14)
returns table (recordatorio_id bigint, titulo text, cuando text, a_quien text,
               confirmar boolean, importancia text, en_palabras text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select r.id, r.titulo, d.momento_local,
         (select string_agg(x.nombre, ', ' order by x.nombre)
            from public.rec_destinatarios x
           where x.recordatorio_id = r.id and x.papel = 'destino'),
         r.confirmar, r.importancia, public.rec_en_palabras(r.id)
    from public.rec_disparos d
    join public.rec_recordatorios r on r.id = d.recordatorio_id
   where d.estado = 'pendiente'
     and d.momento <= now() + make_interval(days => greatest(least(p_dias, 120), 1))
     and r.tenant is not distinct from public.rec_tenant_actual()
     and public.rec_es_staff()
   order by d.momento;
$$;
grant execute on function public.rec_agenda(int) to authenticated;

-- ============================================================================
-- DIAGNÓSTICO — la pieza que grita cuando no puede trabajar
--
-- El 06/08 tres corridas de la auditoría se dieron por buenas sin haber
-- entregado un solo correo: el conector estaba caducado y nada avisaba. Aquí
-- eso no puede pasar en silencio: la pantalla pinta esto en rojo al abrirse.
-- ============================================================================
create or replace function public.rec_diagnostico()
returns table (pieza text, bien boolean, detalle text)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  return query
  with defs as (
    select p.proname,
           pg_get_functiondef(p.oid) like '%MAXRECUERDA_TAPON%' as tapon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     -- ⚠️ `prokind='f'`: `pg_get_functiondef` REVIENTA sobre un agregado, y el
     -- planificador puede evaluarla antes que el filtro de esquema. Pasó al
     -- verificar esta misma instalación: «array_agg is an aggregate function».
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('rec_zona','rec_tenant_actual','rec_es_staff','rec_puede_borrar',
                         'rec_quien_soy','rec_entregar')
  )
  select 'enchufe ' || proname,
         not tapon,
         case when tapon then 'todavía es el tapón de fábrica: el adaptador de esta app no está instalado'
              else 'conectado' end
    from defs

  union all
  select 'directorio', exists (select 1 from public.rec_directorio),
         coalesce((select count(*)::text || ' personas' from public.rec_directorio),
                  'la vista rec_directorio no devuelve a nadie')

  -- ⛔ La primera versión de esto solo comprobaba que EXISTIERA la tabla
  -- `cron.job`. Daba verde en cualquier base con pg_cron instalado, aunque el
  -- latido de MaxRecuerda no estuviera programado — o sea, daba verde justo en
  -- el caso en que nada se dispara. Ahora se pregunta por NUESTRO job y por su
  -- ÚLTIMA CORRIDA: que exista no prueba que corra.
  union all
  select 'latido (pg_cron)',
         coalesce((select j.active from cron.job j where j.jobname = 'maxrecuerda-latido'), false)
         and exists (select 1 from cron.job_run_details rd
                      where rd.jobid = (select jobid from cron.job where jobname = 'maxrecuerda-latido')
                        and rd.status = 'succeeded'
                        and rd.start_time > now() - interval '15 minutes'),
         coalesce((select 'última corrida: ' || to_char(max(rd.start_time) at time zone public.rec_zona(),
                                                        'DD/MM HH24:MI') || ' — ' || max(rd.status)
                     from cron.job_run_details rd
                    where rd.jobid = (select jobid from cron.job where jobname = 'maxrecuerda-latido')),
                  'el job no está programado: NADA se dispara solo')

  union all
  select 'enlace de confirmación',
         coalesce((select enlace_base <> '' from public.rec_config where id = 1), false),
         'sin enlace_base el WhatsApp sale sin botón de «ya lo hice»'

  -- ⛔ Esta pregunta NACIÓ de un hallazgo, no de la teoría: al instalar en
  -- Betangar, `anon` se quedó con la vista abierta porque el adaptador la
  -- recreó después del revoke. Una auditoría que solo sabe mirar donde ya miró
  -- certifica lo que no revisó, así que la comprobación se queda aquí para
  -- siempre y en todas las instalaciones.
  union all
  select 'anon no alcanza el directorio',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and table_name like 'rec\_%'
                        and grantee in ('anon', 'PUBLIC')),
         coalesce((select string_agg(distinct table_name || '.' || privilege_type, ', ')
                     from information_schema.role_table_grants
                    where table_schema = 'public' and table_name like 'rec\_%'
                      and grantee in ('anon', 'PUBLIC')),
                  'cerrado') || ' — si sale algo, corre select rec_cerrar_anon()'

  union all
  select 'avisos sin canal (7 días)',
         not exists (select 1 from public.rec_entregas
                      where estado = 'sin_canal' and creado_at > now() - interval '7 days'),
         coalesce((select count(*)::text || ' avisos no llegaron por WhatsApp'
                     from public.rec_entregas
                    where estado = 'sin_canal' and creado_at > now() - interval '7 days'), '0')

  union all
  select 'avisos vencidos (7 días)',
         not exists (select 1 from public.rec_disparos
                      where estado = 'vencido' and procesado_at > now() - interval '7 days'),
         coalesce((select count(*)::text || ' se pasaron de hora y NO se enviaron'
                     from public.rec_disparos
                    where estado = 'vencido' and procesado_at > now() - interval '7 days'), '0');
end;
$$;
grant execute on function public.rec_diagnostico() to authenticated, service_role;

-- ============================================================================
-- RLS — verbo por verbo, nunca FOR ALL, y el WITH CHECK tan estricto como el USING
-- ============================================================================
alter table public.rec_config          enable row level security;
alter table public.rec_recordatorios   enable row level security;
alter table public.rec_destinatarios   enable row level security;
alter table public.rec_destinos_extra  enable row level security;
alter table public.rec_disparos        enable row level security;
alter table public.rec_entregas        enable row level security;

revoke all on public.rec_config         from anon;
revoke all on public.rec_recordatorios  from anon;
revoke all on public.rec_destinatarios  from anon;
revoke all on public.rec_destinos_extra from anon;
revoke all on public.rec_disparos       from anon;
revoke all on public.rec_entregas       from anon;

do $$
declare t text;
begin
  foreach t in array array['rec_config','rec_recordatorios','rec_destinatarios',
                           'rec_destinos_extra','rec_disparos','rec_entregas'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- rec_config
drop policy if exists rec_cfg_sel on public.rec_config;
drop policy if exists rec_cfg_upd on public.rec_config;
create policy rec_cfg_sel on public.rec_config for select to authenticated
  using (public.rec_es_staff());
create policy rec_cfg_upd on public.rec_config for update to authenticated
  using      (public.rec_es_staff())
  with check (public.rec_es_staff());

-- rec_recordatorios
drop policy if exists rec_rec_sel on public.rec_recordatorios;
drop policy if exists rec_rec_ins on public.rec_recordatorios;
drop policy if exists rec_rec_upd on public.rec_recordatorios;
drop policy if exists rec_rec_del on public.rec_recordatorios;
create policy rec_rec_sel on public.rec_recordatorios for select to authenticated
  using (public.rec_es_staff() and tenant is not distinct from public.rec_tenant_actual());
create policy rec_rec_ins on public.rec_recordatorios for insert to authenticated
  with check (public.rec_es_staff() and tenant is not distinct from public.rec_tenant_actual());
create policy rec_rec_upd on public.rec_recordatorios for update to authenticated
  using      (public.rec_es_staff() and tenant is not distinct from public.rec_tenant_actual())
  with check (public.rec_es_staff() and tenant is not distinct from public.rec_tenant_actual());
create policy rec_rec_del on public.rec_recordatorios for delete to authenticated
  using (public.rec_puede_borrar() and tenant is not distinct from public.rec_tenant_actual());

-- rec_destinatarios — cuelgan del recordatorio; se le pregunta a él.
drop policy if exists rec_dst_sel on public.rec_destinatarios;
drop policy if exists rec_dst_ins on public.rec_destinatarios;
drop policy if exists rec_dst_upd on public.rec_destinatarios;
drop policy if exists rec_dst_del on public.rec_destinatarios;
create policy rec_dst_sel on public.rec_destinatarios for select to authenticated
  using (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id));
create policy rec_dst_ins on public.rec_destinatarios for insert to authenticated
  with check (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id));
create policy rec_dst_upd on public.rec_destinatarios for update to authenticated
  using      (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id))
  with check (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id));
create policy rec_dst_del on public.rec_destinatarios for delete to authenticated
  using (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id));

-- rec_destinos_extra — la lista blanca de MaxRecuerda. Solo el personal la ve,
-- y solo quien puede borrar la vacía.
drop policy if exists rec_dex_sel on public.rec_destinos_extra;
drop policy if exists rec_dex_ins on public.rec_destinos_extra;
drop policy if exists rec_dex_upd on public.rec_destinos_extra;
drop policy if exists rec_dex_del on public.rec_destinos_extra;
create policy rec_dex_sel on public.rec_destinos_extra for select to authenticated
  using (public.rec_es_staff());
create policy rec_dex_ins on public.rec_destinos_extra for insert to authenticated
  with check (public.rec_es_staff());
create policy rec_dex_upd on public.rec_destinos_extra for update to authenticated
  using (public.rec_es_staff()) with check (public.rec_es_staff());
create policy rec_dex_del on public.rec_destinos_extra for delete to authenticated
  using (public.rec_puede_borrar());

-- rec_disparos / rec_entregas — el libro. Se LEE, no se escribe a mano: quien
-- escribe es el motor, con service_role. Un libro que el usuario puede editar
-- no sirve de libro.
drop policy if exists rec_dis_sel on public.rec_disparos;
create policy rec_dis_sel on public.rec_disparos for select to authenticated
  using (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id));

drop policy if exists rec_ent_sel on public.rec_entregas;
create policy rec_ent_sel on public.rec_entregas for select to authenticated
  using (exists (select 1 from public.rec_recordatorios r where r.id = recordatorio_id));

revoke insert, update, delete on public.rec_disparos from authenticated;
revoke insert, update, delete on public.rec_entregas from authenticated;

-- ⛔ El token es la credencial del enlace de «ya lo hice»: no puede salir nunca
-- por PostgREST. Y OJO: un `revoke select (token)` encima de un `grant select`
-- de TABLA no hace nada — el permiso de tabla cubre todas las columnas. Hay que
-- quitar el de tabla y volver a dar columna por columna. Es el mismo error que
-- «grant update(col) es por ROL»: el permiso fino no anula al grueso.
revoke select on public.rec_entregas from authenticated;
grant select (id, disparo_id, recordatorio_id, persona_id, nombre, telefono, papel,
              estado, cola_ref, visto_at, hecho_at, hecho_por, hecho_via,
              escalado_at, error_msg, creado_at)
  on public.rec_entregas to authenticated;

comment on table public.rec_entregas is
  'Cada aviso a cada persona. `token` es una credencial de un solo propósito '
  '(marcar hecho desde el enlace del WhatsApp) y por eso está revocado de la lectura.';

-- ============================================================================
-- ⛔ CERRARLE LA PUERTA A `anon` — LO ÚLTIMO, Y LO MÁS FÁCIL DE OLVIDAR
--
-- Encontrado al verificar la instalación en Betangar el 06/08: `anon` había
-- quedado con SELECT/INSERT/UPDATE/DELETE sobre la VISTA `rec_directorio`.
-- Arriba se revoca sobre las TABLAS y se da por hecho que con eso basta — y no:
--
--   · una VISTA es otro objeto y necesita su propio revoke;
--   · y en estas bases los `default privileges` le regalan a `anon` todo lo
--     que se crea en `public`. La anon key va PUBLICADA en el bundle del
--     navegador: cualquiera la copia del JS.
--
-- Con el adaptador puesto, eso habría dejado el nombre y el teléfono de toda
-- la nómina a un `curl` de distancia. La vista todavía era el tapón, así que no
-- llegó a filtrar nada — pero solo por el orden en que se instaló.
--
-- Lo mismo con las FUNCIONES: por omisión, `execute` es de PUBLIC. Ninguna
-- filtra nada por sí sola (todas preguntan por `rec_es_staff()` o por
-- `rec_quien_soy()`), pero eso es la segunda barrera, no la primera.
-- ============================================================================
-- ⛔ ES UNA FUNCIÓN, NO UN BLOQUE SUELTO, Y ESO IMPORTA.
--    Primer intento: se revocó aquí mismo, al final del núcleo. No sirvió de
--    nada — el adaptador hace `drop view ... create view rec_directorio` DESPUÉS,
--    y los default privileges se la vuelven a regalar a `anon` al recrearla.
--    Un candado que depende del orden de instalación no es un candado.
--    Ahora **todo adaptador termina llamando a esto**, y es lo último que corre.
create or replace function public.rec_cerrar_anon()
returns text
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare f record; n int := 0;
begin
  revoke all on public.rec_directorio from anon, public;
  grant  select on public.rec_directorio to authenticated;

  for f in
    select p.oid::regprocedure as firma, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and p.proname like 'rec\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    -- La ÚNICA que anon necesita: confirmar «ya lo hice» desde el enlace del
    -- WhatsApp. El token es la credencial y solo sirve para marcar esa entrega.
    if f.proname = 'rec_confirmar_por_token' then
      execute format('grant execute on function %s to anon, authenticated', f.firma);
    elsif f.proname in ('rec_tick','rec_entregar','rec_programar','rec_cerrar_anon') then
      execute format('grant execute on function %s to service_role', f.firma);   -- solo el motor
    else
      execute format('grant execute on function %s to authenticated, service_role', f.firma);
    end if;
    n := n + 1;
  end loop;

  return n || ' funciones cerradas y la vista revocada de anon';
end;
$$;

select public.rec_cerrar_anon();
