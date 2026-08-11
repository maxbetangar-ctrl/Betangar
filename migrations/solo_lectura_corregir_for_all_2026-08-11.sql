-- ════════════════════════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN DEL CANDADO DE SOLO LECTURA — las políticas `FOR ALL` también gobiernan el SELECT
--
-- ⛔ EL ERROR. `solo_lectura_es_del_motor_2026-08-11.sql` le colgó `and not app_solo_lectura()` a
-- TODAS las políticas de escritura… incluidas las de `cmd='ALL'`. Y una política FOR ALL no es
-- «de escritura»: su `using` gobierna **también el SELECT**. O sea que a la auditora le cerré la
-- LECTURA de `seniat_retenciones` — que es, justamente, la sección de retenciones IVA/ISLR de la
-- Carpeta del Auditor. Su informe habría salido **sin retenciones y sin decir por qué**: el peor
-- resultado posible, porque un documento incompleto que se ve completo miente por omisión.
--
-- No lo encontró ninguna revisión: lo encontró generar el documento de verdad y mirar los números.
--
-- ⛔ Y UN SEGUNDO ERROR, de alcance: excluí `edu_*` y `usdt_*` (Geppetto) pero **no `mp_*`**, que
-- es MaxPersonal. Le agregué la cláusula a 15 políticas de otro producto. No hacía daño
-- —`app_rol()` lee `btg_usuarios` y los usuarios de MaxPersonal no están ahí— pero no eran mías.
--
-- LO QUE SE HACE:
--   1. Se le quita el candado a TODAS las políticas `FOR ALL` (deshace los dos errores).
--   2. Las dos que sí son de Betangar y estaban abiertas a `authenticated` con `using(true)`
--      —`seniat_retenciones` y `health_check`— se parten **verbo por verbo**, que es como debieron
--      estar desde el principio ([[rls-verbo-por-verbo-no-for-all]]): SELECT libre, y el candado
--      solo en INSERT/UPDATE/DELETE.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _fx_log(paso text, detalle text, n int) on commit preserve rows;
truncate _fx_log;

-- ── 1) Quitar el candado de todas las FOR ALL ────────────────────────────────────────────────
do $mig$
declare r record; nq text; nw text; c int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname='public' and cmd='ALL'
       and coalesce(qual,'')||coalesce(with_check,'') like '%app_solo_lectura()%'
  loop
    nq := regexp_replace(coalesce(r.qual,''),       '^\((.*)\s+AND\s+\(NOT app_solo_lectura\(\)\)\)$', '\1');
    nw := regexp_replace(coalesce(r.with_check,''), '^\((.*)\s+AND\s+\(NOT app_solo_lectura\(\)\)\)$', '\1');
    if nq = coalesce(r.qual,'') and r.qual is not null then
      raise exception 'no pude limpiar el using de %.%: %', r.tablename, r.policyname, r.qual;
    end if;
    execute format('alter policy %I on public.%I using (%s) with check (%s)', r.policyname, r.tablename, nq, nw);
    c := c + 1;
  end loop;
  insert into _fx_log values ('1. FOR ALL liberadas', 'incluye las 15 de MaxPersonal que no eran mías', c);
end $mig$;

-- ── 2) Las dos de Betangar, verbo por verbo ──────────────────────────────────────────────────
do $mig$
declare t text;
begin
  foreach t in array array['seniat_retenciones','health_check'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('drop policy if exists %I on public.%I', t||'_auth_all', t);
      execute format('drop policy if exists btg_auth_all on public.%I', t);
      execute format('drop policy if exists %I on public.%I', t||'_sel', t);
      execute format('drop policy if exists %I on public.%I', t||'_ins', t);
      execute format('drop policy if exists %I on public.%I', t||'_upd', t);
      execute format('drop policy if exists %I on public.%I', t||'_del', t);
      -- LEER: cualquiera con sesión, como estaba. La auditora incluida.
      execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_sel', t);
      -- ESCRIBIR: como estaba, menos los roles de solo consulta.
      execute format('create policy %I on public.%I for insert to authenticated with check (not public.app_solo_lectura())', t||'_ins', t);
      execute format('create policy %I on public.%I for update to authenticated using (not public.app_solo_lectura()) with check (not public.app_solo_lectura())', t||'_upd', t);
      execute format('create policy %I on public.%I for delete to authenticated using (not public.app_solo_lectura())', t||'_del', t);
    end if;
  end loop;
  insert into _fx_log values ('2. verbo por verbo', 'seniat_retenciones + health_check', 2);
end $mig$;

-- ── 3) Control ───────────────────────────────────────────────────────────────────────────────
insert into _fx_log
select '3. ⛔ CONTROL', 'políticas FOR ALL que todavía tienen el candado (debe ser 0)', count(*)::int
  from pg_policies where schemaname='public' and cmd='ALL'
   and coalesce(qual,'')||coalesce(with_check,'') like '%app_solo_lectura()%';

insert into _fx_log
select '3. control', 'políticas de mp_* con el candado (debe ser 0)', count(*)::int
  from pg_policies where schemaname='public' and tablename like 'mp\_%'
   and coalesce(qual,'')||coalesce(with_check,'') like '%app_solo_lectura()%';

insert into _fx_log
select '3. control', 'seniat_retenciones: políticas por verbo', count(*)::int
  from pg_policies where schemaname='public' and tablename='seniat_retenciones';

insert into _fx_log
select '3. control', 'escritura SIN candado en tablas de Betangar (debe ser 0)', count(*)::int
  from pg_policies
 where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE')
   and tablename not like 'edu\_%' and tablename not like 'usdt\_%' and tablename not like 'mp\_%'
   and tablename <> 'auditoria'
   and coalesce(qual,'')||coalesce(with_check,'') not like '%app_solo_lectura()%';

select * from _fx_log;
