-- ════════════════════════════════════════════════════════════════════════════
-- COLA DE ARREGLOS — la auditoría deja de solo avisar y empieza a cerrar huecos.
--
-- POR QUÉ (13/08/2026, decisión de Máximo): hoy la auditoría encuentra la falla,
-- se la manda a Máximo, y él se la reenvía a un agente para que la arregle. Su
-- aprobación no está revisando el SQL línea por línea: es un cuello de botella,
-- no un control. Hay 52 hallazgos abiertos y los que pasan de 7 días se llaman
-- ENQUISTADOS justamente porque nadie llega.
--
-- ⛔ EL LÍMITE NO PUEDE VIVIR EN EL PROMPT. Una instrucción no es un candado.
-- Por eso acá la rutina NO manda SQL: manda QUÉ quiere (tipo, objeto, rol) y es
-- esta función la que arma la sentencia con `format`. No hay SQL libre que
-- validar, así que no hay nada que colar.
--
-- LOS CUATRO TIPOS PERMITIDOS COMPARTEN UNA PROPIEDAD: ninguno toca una sola
-- fila de datos, y todos se deshacen con un comando. Lo peor que puede pasar es
-- que algo deje de funcionar — nunca que algo se pierda. Ese es el criterio, no
-- la gravedad del hallazgo.
--
-- No lleva cron a propósito: la llama la propia auditoría al final de su corrida.
-- Así los cambios ocurren en UN momento conocido (6 AM, antes de que abran las
-- oficinas) y no a cualquier hora sin que nadie mire.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.cola_arreglos (
  id           bigint generated always as identity primary key,
  hallazgo_id  text        not null,          -- 'maxstock/public.ventas/grant-anon-insert'
  tipo         text        not null,
  objeto       text        not null,          -- 'public.ventas' o 'public.mi_fn(uuid, text)'
  rol          text,                          -- anon | authenticated
  privilegio   text,                          -- SELECT | INSERT | UPDATE | DELETE | EXECUTE
  motivo       text        not null,          -- por qué está mal, en una línea
  evidencia    text        not null,          -- CÓMO comprobó que nadie lo usa
  estado       text        not null default 'propuesto',
  sql_aplicado text,
  sql_deshacer text,                          -- el deshacer, escrito ANTES de aplicar
  error        text,
  created_at   timestamptz not null default now(),
  aplicado_at  timestamptz,
  constraint cola_arreglos_tipo_ck check (tipo in (
    'revocar_privilegio',   -- revoke <priv> on <tabla> from <rol>
    'revocar_ejecucion',    -- revoke execute on function <fn> from <rol>
    'fijar_search_path',    -- alter function <fn> set search_path = public, pg_temp
    'encender_rls'          -- alter table <t> enable row level security
  )),
  constraint cola_arreglos_estado_ck check (estado in (
    'propuesto', 'aplicado', 'rechazado', 'fallido'
  ))
);

create index if not exists cola_arreglos_pendientes_idx on public.cola_arreglos (estado, id);
create unique index if not exists cola_arreglos_hallazgo_idx
  on public.cola_arreglos (hallazgo_id) where estado in ('propuesto', 'aplicado');

alter table public.cola_arreglos enable row level security;
revoke all on public.cola_arreglos from anon, authenticated, public;

-- ── Lo que NO se toca jamás, decida lo que decida la auditoría ──────────────
-- Vive en la BASE, no en el prompt. Si mañana alguien convence a la rutina de
-- que hay que revocar algo de acá, la función lo rechaza igual.
create table if not exists public.arreglos_intocables (
  patron text primary key,   -- se compara con LIKE contra `objeto`
  motivo text not null
);
alter table public.arreglos_intocables enable row level security;
revoke all on public.arreglos_intocables from anon, authenticated, public;

insert into public.arreglos_intocables (patron, motivo) values
  ('public.configuracion',   'guarda los secretos: tocarle permisos puede dejar sin credencial a los workers'),
  ('public.cola_%',          'las colas de entrega: si se rompen, se pierde el canal por el que avisa'),
  ('public.arreglos_%',      'el candado no se modifica a si mismo'),
  ('auth.%',                 'esquema de Supabase Auth'),
  ('storage.%',              'esquema de Storage: los permisos de fotos se deciden a mano')
on conflict (patron) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- El aplicador. Devuelve qué hizo con cada fila, para que la auditoría lo
-- cuente en su informe. `p_max` limita cuántos por corrida: si se aplican ocho
-- cosas y algo se rompe, no se sabe cuál fue.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.aplicar_arreglos_seguros(p_max integer default 5)
returns table (id bigint, hallazgo_id text, estado text, sql_aplicado text, sql_deshacer text, error text)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $fn$
declare
  r            record;
  v_sql        text;
  v_undo       text;
  v_oid        oid;
  v_filas      bigint;
  v_rechazo    text;
begin
  -- Las columnas van SIEMPRE calificadas con `c.`: los nombres de salida de esta
  -- función (id, estado, error…) son variables y chocan con los de la tabla.
  for r in
    select c.* from public.cola_arreglos c
     where c.estado = 'propuesto' order by c.id limit greatest(p_max, 0)
  loop
    v_sql := null; v_undo := null; v_rechazo := null;

    <<validar>>
    begin
      -- 1) El rol solo puede ser uno de los dos públicos. Nunca postgres ni service_role.
      if r.tipo in ('revocar_privilegio','revocar_ejecucion')
         and coalesce(r.rol,'') not in ('anon','authenticated') then
        v_rechazo := format('rol no permitido: %L (solo anon o authenticated)', r.rol);
        exit validar;
      end if;

      -- 2) Nada de la lista de intocables, diga lo que diga la auditoría.
      if exists (select 1 from public.arreglos_intocables t where r.objeto like t.patron) then
        select format('objeto protegido (%s)', t.motivo) into v_rechazo
        from public.arreglos_intocables t where r.objeto like t.patron limit 1;
        exit validar;
      end if;

      -- 3) La evidencia es obligatoria y tiene que decir algo.
      if length(coalesce(r.evidencia,'')) < 20 then
        v_rechazo := 'sin evidencia suficiente de que nadie lo usa';
        exit validar;
      end if;

      if r.tipo = 'revocar_privilegio' then
        if coalesce(r.privilegio,'') not in ('SELECT','INSERT','UPDATE','DELETE') then
          v_rechazo := format('privilegio no permitido: %L', r.privilegio);
          exit validar;
        end if;
        -- El objeto tiene que existir Y ser una tabla o vista de verdad.
        v_oid := to_regclass(r.objeto);
        if v_oid is null then
          v_rechazo := 'la tabla no existe'; exit validar;
        end if;
        -- Y el rol tiene que TENER ese privilegio ahora: si no, no hay nada que arreglar.
        if not has_table_privilege(r.rol, v_oid, r.privilegio) then
          v_rechazo := 'el rol ya no tiene ese privilegio (arreglado por otra via)'; exit validar;
        end if;
        v_sql  := format('revoke %s on %s from %I', r.privilegio, v_oid::regclass, r.rol);
        v_undo := format('grant %s on %s to %I',    r.privilegio, v_oid::regclass, r.rol);

      elsif r.tipo = 'revocar_ejecucion' then
        begin
          v_oid := r.objeto::regprocedure;
        exception when others then
          v_rechazo := 'la funcion no existe o falta la firma con argumentos'; exit validar;
        end;
        if not has_function_privilege(r.rol, v_oid, 'EXECUTE') then
          v_rechazo := 'el rol ya no puede ejecutarla'; exit validar;
        end if;
        v_sql  := format('revoke execute on function %s from %I', v_oid::regprocedure, r.rol);
        v_undo := format('grant execute on function %s to %I',    v_oid::regprocedure, r.rol);

      elsif r.tipo = 'fijar_search_path' then
        begin
          v_oid := r.objeto::regprocedure;
        exception when others then
          v_rechazo := 'la funcion no existe o falta la firma con argumentos'; exit validar;
        end;
        if exists (select 1 from pg_proc p where p.oid = v_oid and p.proconfig is not null) then
          v_rechazo := 'ya tiene search_path fijado'; exit validar;
        end if;
        v_sql  := format('alter function %s set search_path = public, pg_temp', v_oid::regprocedure);
        v_undo := format('alter function %s reset search_path', v_oid::regprocedure);

      elsif r.tipo = 'encender_rls' then
        v_oid := to_regclass(r.objeto);
        if v_oid is null then
          v_rechazo := 'la tabla no existe'; exit validar;
        end if;
        -- ⛔ CANDADO DURO, y va PRIMERO a propósito: solo sobre tablas VACIAS.
        -- Encender RLS sobre una tabla con datos deja a la app sin ver sus propias
        -- filas, EN SILENCIO. Esto no se le pregunta a la auditoría: se cuenta acá.
        -- Va antes que cualquier otro chequeo para que sea el que decide, y para
        -- que se pueda probar de verdad sobre cualquier tabla.
        execute format('select count(*) from %s', v_oid::regclass) into v_filas;
        if v_filas > 0 then
          v_rechazo := format('la tabla tiene %s filas: encender RLS sin politicas la dejaria muda', v_filas);
          exit validar;
        end if;
        if exists (select 1 from pg_class c where c.oid = v_oid and c.relrowsecurity) then
          v_rechazo := 'ya tiene RLS encendido'; exit validar;
        end if;
        v_sql  := format('alter table %s enable row level security',  v_oid::regclass);
        v_undo := format('alter table %s disable row level security', v_oid::regclass);
      end if;
    end;

    if v_rechazo is not null then
      update public.cola_arreglos c
         set estado = 'rechazado', error = v_rechazo
       where c.id = r.id;
    else
      begin
        execute v_sql;
        update public.cola_arreglos c
           set estado = 'aplicado', sql_aplicado = v_sql, sql_deshacer = v_undo,
               aplicado_at = now(), error = null
         where c.id = r.id;
      exception when others then
        update public.cola_arreglos c
           set estado = 'fallido', sql_aplicado = v_sql, sql_deshacer = v_undo,
               error = left(SQLERRM, 400)
         where c.id = r.id;
      end;
    end if;
  end loop;

  return query
    select c.id, c.hallazgo_id, c.estado, c.sql_aplicado, c.sql_deshacer, c.error
    from public.cola_arreglos c
    where c.aplicado_at > now() - interval '10 minutes'
       or (c.estado in ('rechazado','fallido') and c.created_at > now() - interval '1 day')
    order by c.id;
end;
$fn$;

revoke all on function public.aplicar_arreglos_seguros(integer) from public, anon, authenticated;
