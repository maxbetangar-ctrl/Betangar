-- ════════════════════════════════════════════════════════════════════════════════════════════
-- DOS CABOS QUE DEJÓ LA CORRECCIÓN ANTERIOR — y el segundo es un agujero
--
-- 1. Quedaban **24 políticas de `mp_*` (MaxPersonal)** con mi cláusula. La corrección anterior solo
--    limpió las `FOR ALL`; estas son INSERT/UPDATE/DELETE. No son de este producto: se limpian.
--
-- 2. ⛔ En `seniat_retenciones` sobrevivió la política vieja **`seniat_auth_all`** (FOR ALL,
--    `using(true)` para `authenticated`). El `drop` de la migración anterior buscaba
--    `seniat_retenciones_auth_all` — **le erré al nombre y el drop no falló, simplemente no
--    encontró nada**. Resultado: la tabla quedó con las 4 políticas nuevas por verbo Y la vieja
--    abierta al lado. Como las permisivas se suman con OR, la vieja **le devuelve la escritura a
--    todo el mundo**, auditora incluida. El candado nuevo no servía de nada.
--    Es la misma lección de hoy: un `drop if exists` con el nombre equivocado se ve idéntico a uno
--    que funcionó. Por eso este archivo NO nombra políticas a mano: las busca.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _fx2_log(paso text, detalle text, n int) on commit preserve rows;
truncate _fx2_log;

-- ── 1) MaxPersonal, fuera ────────────────────────────────────────────────────────────────────
do $mig$
declare r record; nq text; nw text; c int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname='public' and tablename like 'mp\_%'
       and coalesce(qual,'')||coalesce(with_check,'') like '%app_solo_lectura()%'
  loop
    nq := regexp_replace(coalesce(r.qual,''),       '^\((.*)\s+AND\s+\(NOT app_solo_lectura\(\)\)\)$', '\1');
    nw := regexp_replace(coalesce(r.with_check,''), '^\((.*)\s+AND\s+\(NOT app_solo_lectura\(\)\)\)$', '\1');
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.policyname, r.tablename, nq, nw);
    elsif r.qual is not null then
      execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, nq);
    else
      execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, nw);
    end if;
    c := c + 1;
  end loop;
  insert into _fx2_log values ('1. MaxPersonal', 'políticas devueltas como estaban', c);
end $mig$;

-- ── 2) Borrar TODA política FOR ALL que quede en esas dos tablas, se llame como se llame ─────
do $mig$
declare r record; c int := 0;
begin
  for r in
    select tablename, policyname from pg_policies
     where schemaname='public' and cmd='ALL' and tablename in ('seniat_retenciones','health_check')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    c := c + 1;
  end loop;
  insert into _fx2_log values ('2. FOR ALL sobrantes', 'borradas de seniat_retenciones/health_check', c);
end $mig$;

-- ── 3) Control ───────────────────────────────────────────────────────────────────────────────
insert into _fx2_log
select '3. ⛔ CONTROL', 'políticas de mp_* con mi candado (debe ser 0)', count(*)::int
  from pg_policies where schemaname='public' and tablename like 'mp\_%'
   and coalesce(qual,'')||coalesce(with_check,'') like '%app_solo_lectura()%';

insert into _fx2_log
select '3. ⛔ CONTROL', 'FOR ALL en seniat_retenciones/health_check (debe ser 0)', count(*)::int
  from pg_policies where schemaname='public' and cmd='ALL' and tablename in ('seniat_retenciones','health_check');

insert into _fx2_log
select '3. control', tablename||': '||string_agg(cmd||'/'||policyname, ', ' order by cmd), count(*)::int
  from pg_policies where schemaname='public' and tablename in ('seniat_retenciones','health_check')
  group by tablename;

select * from _fx2_log;
