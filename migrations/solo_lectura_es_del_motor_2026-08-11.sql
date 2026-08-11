-- ════════════════════════════════════════════════════════════════════════════════════════════
-- «SOLO LECTURA» PASA A SER UNA PROPIEDAD DE LA BASE, NO UNA LISTA QUE HAY QUE REVISAR
--
-- ⛔ POR QUÉ EXISTE ESTA MIGRACIÓN. Al crear el rol `auditor` se comprobó lo obvio: que no
-- estuviera en ninguna política de escritura. Estaba en cero. Y la prueba en vivo, con su sesión
-- real, **igual escribió en `configuracion`**:
--
--     cfg_ins  →  with check ( (not cfg_clave_sensible(clave)) or app_rol() = any(...) )
--
-- La primera rama no mira el rol: **cualquiera con sesión** puede insertar una clave no sensible.
-- Las políticas se suman con OR, así que una política amplia le gana a todas las listas de roles
-- que uno revise. Verificar «no está en ninguna lista» no prueba nada mientras exista UNA política
-- que no pregunte por el rol. [[norma-barrido-no-es-candado]] [[norma-candado-que-depende-del-orden]]
--
-- Y no era solo la auditora: por esa misma rama, el VIGILANTE o el MECÁNICO podían escribir
-- `configuracion` —donde viven los precios del gasoil y la marca de la empresa— desde cualquier
-- consola. Eso ya estaba abierto antes de hoy.
--
-- LO QUE SE HACE. Se declara `app_solo_lectura()` y se le agrega `and not app_solo_lectura()` a
-- TODAS las políticas de INSERT/UPDATE/DELETE/ALL del esquema (menos las de Geppetto). Es un AND
-- con una función que da `false` para todo el mundo salvo los roles declarados de solo lectura:
-- **nadie más cambia de comportamiento**. Y el día que se agregue otro rol de consulta, se agrega
-- a una lista de una línea y queda cerrado en toda la base de una vez.
--
-- ⚠️ `security definer`: las políticas de `anon` (la app del chofer) también van a llamarla, y a
-- `anon` se le revocó `app_rol()`. Sin DEFINER, la política reventaría en vez de dejar pasar.
-- Para `anon`, `app_rol()` da null → no es de solo lectura → `not false` = pasa igual que hoy.
--
-- Correr con: node scripts/correr-sql.mjs hrkjddehqnzcqwlkklqm migrations/solo_lectura_es_del_motor_2026-08-11.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _sl_log(paso text, detalle text, n int) on commit preserve rows;
truncate _sl_log;

-- ── 1) La declaración: quién entra a MIRAR ───────────────────────────────────────────────────
create or replace function public.app_solo_lectura()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(public.app_rol() = any (array['auditor']), false);
$$;
revoke all on function public.app_solo_lectura() from public;
grant execute on function public.app_solo_lectura() to anon, authenticated;

-- ── 2) Se cuelga de TODA política de escritura ───────────────────────────────────────────────
do $mig$
declare r record; nq text; nw text; c int := 0;
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname='public'
       and cmd in ('INSERT','UPDATE','DELETE','ALL')
       and tablename not like 'edu\_%' and tablename not like 'usdt\_%'
       -- correr dos veces no la agrega dos veces
       and coalesce(qual,'')||coalesce(with_check,'') not like '%app_solo_lectura()%'
  loop
    nq := case when r.qual       is null then null else '('||r.qual      ||') and not public.app_solo_lectura()' end;
    nw := case when r.with_check is null then null else '('||r.with_check||') and not public.app_solo_lectura()' end;
    -- Una política ALL sin `with check` hereda el `using`; al reescribirla hay que darle los dos,
    -- o Postgres se queda con el using viejo para la comprobación de escritura.
    if r.cmd = 'ALL' and nw is null and nq is not null then nw := nq; end if;

    if nq is not null and nw is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.policyname, r.tablename, nq, nw);
    elsif nq is not null then
      execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, nq);
    else
      execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, nw);
    end if;
    c := c + 1;
  end loop;
  insert into _sl_log values ('1. políticas blindadas', 'INSERT/UPDATE/DELETE/ALL de Betangar', c);
end $mig$;

-- ── 3) Control ───────────────────────────────────────────────────────────────────────────────
insert into _sl_log
select '2. ⛔ CONTROL', 'políticas de escritura SIN el candado (debe ser 0)', count(*)::int
  from pg_policies
 where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
   and tablename not like 'edu\_%' and tablename not like 'usdt\_%'
   and coalesce(qual,'')||coalesce(with_check,'') not like '%app_solo_lectura()%';

insert into _sl_log
select '3. control', 'políticas de Geppetto tocadas (debe ser 0)', count(*)::int
  from pg_policies
 where schemaname='public' and tablename like 'edu\_%'
   and coalesce(qual,'')||coalesce(with_check,'') like '%app_solo_lectura()%';

select * from _sl_log;

-- ── 4) EXCEPCIÓN: la bitácora `auditoria` ────────────────────────────────────────────────────
-- Es de SOLO AGREGAR (no tiene política de DELETE ni de UPDATE) y es el rastro de quién hizo qué.
-- Si el candado también la tapara, la auditora entraría, miraría media empresa y **no quedaría
-- registro de ninguna de sus consultas**. El rastro de quien audita es el que menos puede faltar.
-- Bloquear de más también rompe.
do $mig$
declare r record; c int := 0;
begin
  for r in
    select policyname, with_check from pg_policies
     where schemaname='public' and tablename='auditoria' and cmd='INSERT'
       and coalesce(with_check,'') like '%app_solo_lectura()%'
  loop
    execute format('alter policy %I on public.auditoria with check (%s)',
      r.policyname, replace(r.with_check, ' AND (NOT app_solo_lectura())', ''));
    c := c + 1;
  end loop;
  insert into _sl_log values ('4. excepción bitácora', 'políticas de INSERT en `auditoria` liberadas', c);
end $mig$;

select * from _sl_log;
