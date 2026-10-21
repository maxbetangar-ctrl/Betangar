-- ============================================================================
-- LAS TONELADAS POR VIAJE BAJAN A LA BASE, Y NO SE PUEDEN CAMBIAR EN SILENCIO
-- 2026-10-21.
--
-- POR QUE EXISTE
-- Todo el cuadro de toneladas de la empresa -41.280 t al 18/10/2026- sale de
-- multiplicar los viajes por la capacidad declarada del camion. Ese numero
-- vivia como VALOR POR DEFECTO en el codigo (`_tonsPorViaje()` devolvia 8 si
-- no encontraba otra cosa) y `configuracion.general` ni siquiera lo tenia: la
-- fila se habia guardado antes de que el campo existiera. Comprobado:
-- `(valor::jsonb) ? 'tonsViaje'` daba FALSE.
--
-- Maximo lo confirmo por escrito el 21/10/2026: «SON 8 TONS POR VIAJE».
--
-- ⛔ PERO BAJAR EL 8 A UNA FILA NO ALCANZA, Y ESA ES LA PARTE QUE IMPORTA.
--    La capacidad no es un ajuste de pantalla: es el DIVISOR de la historia
--    entera. El dia que alguien escriba 7,5 en Config ▸ General, las 41.280
--    toneladas pasan a ser 38.700 **hacia atras**, en informes que ya se
--    firmaron y se mandaron a los socios, y no quedaria rastro de que el
--    numero cambio ni de quien lo cambio.
--    El arreglo de un valor derivado es un TRIGGER, no una fila.
--    [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
-- ⛔ Y UNA SOLA FUENTE. El valor vivo sigue siendo `configuracion.general`,
--    que es de donde la app ya lee y escribe: una segunda tabla con «la
--    capacidad de verdad» seria una segunda lista a mano, y esas se
--    desincronizan. Lo que se agrega NO es otra copia del numero: es su
--    HISTORIAL, que lo escribe la base sola.
--    [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ⛔ LO QUE ESTO **NO** HACE, dicho de frente: los informes siguen aplicando la
--    capacidad VIGENTE a todos los meses. El historial deja la procedencia y
--    hace imposible un cambio mudo; recalcular cada mes con la capacidad que
--    regia ese mes es otra pieza, y hoy no hace falta porque hay UNA sola
--    declaracion. [[norma-falta-de-dato-no-es-un-dato]]
-- ============================================================================

-- ── 0 · RESPALDO. Se toca una fila que configura toda la app. ───────────────
create table if not exists configuracion_respaldo_20261021 as
  select * from configuracion where clave = 'general';

-- ── 1 · EL HISTORIAL ───────────────────────────────────────────────────────
create table if not exists capacidad_viaje_historial (
  id             bigint generated always as identity primary key,
  desde          date        not null,          -- desde cuando rige esta capacidad
  toneladas      numeric     not null check (toneladas > 0),
  anterior       numeric,                       -- null = es la primera declaracion
  declarado_por  text        not null,
  nota           text,
  anotado_en     timestamptz not null default now()
);

comment on table capacidad_viaje_historial is
  'Historial de la capacidad declarada por viaje. NO es la fuente del valor vivo (esa es configuracion.general ▸ tonsViaje): es el rastro de cada cambio, escrito por el trigger trg_capacidad_viaje. Todo el cuadro de toneladas de la empresa cuelga de este numero.';

alter table capacidad_viaje_historial enable row level security;

drop policy if exists capacidad_viaje_historial_lee on capacidad_viaje_historial;
create policy capacidad_viaje_historial_lee on capacidad_viaje_historial
  for select to authenticated using (true);

-- ⛔ No hay policy de insert/update/delete A PROPOSITO: el historial lo escribe
--    SOLO el trigger (security definer). Un rastro que el usuario puede editar
--    no es un rastro.
revoke all on capacidad_viaje_historial from anon, public;
grant select on capacidad_viaje_historial to authenticated;

-- ── 2 · EL TRIGGER: nadie cambia la capacidad sin dejar rastro ──────────────
create or replace function capacidad_viaje_anota()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_nuevo  numeric;
  v_ultimo numeric;
  v_quien  text;
begin
  if new.clave <> 'general' then return new; end if;

  begin
    v_nuevo := (new.valor::jsonb ->> 'tonsViaje')::numeric;
  exception when others then
    -- Un `valor` que no es JSON valido es problema de quien lo escribio, no de
    -- este trigger: no se traga el guardado de la configuracion por eso.
    return new;
  end;
  if v_nuevo is null or v_nuevo <= 0 then return new; end if;

  select toneladas into v_ultimo
    from capacidad_viaje_historial order by desde desc, id desc limit 1;

  -- Solo se anota cuando CAMBIA. Guardar la configuracion sin tocar la
  -- capacidad no tiene por que ensuciar el historial: un rastro que anota
  -- siempre no deja ver el cambio que si importa.
  if v_ultimo is not null and v_ultimo = v_nuevo then return new; end if;

  v_quien := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    session_user);

  insert into capacidad_viaje_historial (desde, toneladas, anterior, declarado_por, nota)
  values (current_date, v_nuevo, v_ultimo, v_quien,
          'Cambiado desde Configuracion ▸ General');

  return new;
end
$fn$;

drop trigger if exists trg_capacidad_viaje on configuracion;
create trigger trg_capacidad_viaje
  after insert or update on configuracion
  for each row execute function capacidad_viaje_anota();

-- ── 3 · LA PRIMERA DECLARACION ─────────────────────────────────────────────
-- `desde` es el 04/03/2026, el dia del primer viaje: es la capacidad con la
-- que se contaron TODAS las toneladas de la historia, no una que empieza hoy.
insert into capacidad_viaje_historial (desde, toneladas, anterior, declarado_por, nota)
select date '2026-03-04', 8, null, 'Máximo Betancourt',
       'Declarado por escrito el 21/10/2026. Rige desde el primer viaje: es la capacidad con la que están contadas las 41.280 toneladas del informe a los socios.'
where not exists (select 1 from capacidad_viaje_historial);

-- ── 4 · EL VALOR VIVO, A LA BASE ───────────────────────────────────────────
-- Se MEZCLA en el JSON que ya esta: sobreescribir la fila entera borraria
-- tarifa, km, tanque y el resto de la configuracion de la empresa.
update configuracion
   set valor = (valor::jsonb || jsonb_build_object('tonsViaje', 8))::text
 where clave = 'general';

-- ── 5 · LO QUE LEE LA PANTALLA ─────────────────────────────────────────────
create or replace function btg_capacidad_viaje()
returns table (toneladas numeric, desde date, declarado_por text, nota text, cambios bigint)
language sql
stable
security definer
set search_path = public
as $$
  select h.toneladas, h.desde, h.declarado_por, h.nota,
         (select count(*) from capacidad_viaje_historial)
    from capacidad_viaje_historial h
   order by h.desde desc, h.id desc
   limit 1
$$;

comment on function btg_capacidad_viaje is
  'La capacidad por viaje vigente, con su procedencia: desde cuando, quien la declaro y cuantas veces cambio. Para que el papel pueda decir de donde sale el numero en vez de solo mostrarlo.';

revoke all on function btg_capacidad_viaje() from anon, public;
grant execute on function btg_capacidad_viaje() to authenticated;

-- ── CONTROL POSITIVO ───────────────────────────────────────────────────────
do $$
declare
  n_antes   bigint;
  n_prueba  bigint;
  n_final   bigint;
  v_cfg     numeric;
  v_rpc     numeric;
  v_tarifa  numeric;
begin
  -- a) El valor vivo quedo, y no se llevo por delante el resto de la config.
  select (valor::jsonb ->> 'tonsViaje')::numeric, (valor::jsonb ->> 'tarifa')::numeric
    into v_cfg, v_tarifa
    from configuracion where clave = 'general';
  if v_cfg is distinct from 8 then
    raise exception 'configuracion.general no quedo con tonsViaje=8 (quedo %)', v_cfg;
  end if;
  if v_tarifa is null then
    raise exception 'la mezcla del JSON se llevo por delante el resto de la configuracion';
  end if;

  -- b) La RPC contesta y contesta LO MISMO. Dos numeros distintos para la misma
  --    pregunta es peor que uno solo mal.
  select toneladas into v_rpc from btg_capacidad_viaje();
  if v_rpc is distinct from v_cfg then
    raise exception 'la RPC dice % y la configuracion %', v_rpc, v_cfg;
  end if;

  -- c) ⛔ QUE EL TRIGGER SUENE. Un rastro que no se prueba se descubre vacio el
  --    dia que hace falta. Se cambia la capacidad de verdad, se comprueba que
  --    quedo anotada, y se deshace: la prueba no puede dejar basura.
  select count(*) into n_antes from capacidad_viaje_historial;
  begin
    update configuracion
       set valor = (valor::jsonb || jsonb_build_object('tonsViaje', 7))::text
     where clave = 'general';
    select count(*) into n_prueba from capacidad_viaje_historial;
    if n_prueba <> n_antes + 1 then
      raise exception 'el trigger NO anoto el cambio de capacidad: % filas antes, % despues',
        n_antes, n_prueba;
    end if;
    if not exists (select 1 from capacidad_viaje_historial
                    where toneladas = 7 and anterior = 8) then
      raise exception 'el trigger anoto una fila pero sin el valor anterior';
    end if;
    raise exception 'DESHACER_LA_PRUEBA';
  exception when others then
    if sqlerrm <> 'DESHACER_LA_PRUEBA' then raise; end if;
  end;

  -- d) Y que la prueba se haya deshecho de verdad.
  select count(*) into n_final from capacidad_viaje_historial;
  if n_final <> n_antes then
    raise exception 'la prueba del trigger dejo basura: % filas, deberian ser %', n_final, n_antes;
  end if;
  if (select (valor::jsonb ->> 'tonsViaje')::numeric from configuracion where clave='general') <> 8 then
    raise exception 'la prueba del trigger dejo la capacidad en otro valor';
  end if;

  -- e) anon no mira la operacion de la empresa.
  if has_function_privilege('anon', 'btg_capacidad_viaje()', 'execute') then
    raise exception 'anon puede ejecutar btg_capacidad_viaje()';
  end if;
  if has_table_privilege('anon', 'capacidad_viaje_historial', 'select') then
    raise exception 'anon puede leer capacidad_viaje_historial';
  end if;

  raise notice 'OK · tonsViaje=% en la base, % declaracion(es), el trigger suena y la prueba no dejo rastro',
    v_cfg, n_antes;
end $$;
