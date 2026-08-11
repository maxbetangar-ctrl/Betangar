-- ═══════════════════════════════════════════════════════════════════════════════
-- Quitarle a `anon` 3 grants que no usa nadie — alinear con VIDECA y FLOTILLA
-- 2026-08-11
--
-- Mismo criterio y misma revisión que en FLOTILLA (`cef5344`): grants a `anon`
-- sobre tablas SIN política para `anon`. Hoy son inertes —el RLS los bloquea—
-- pero el candado que los detiene es OTRO: el día que alguien agregue una política
-- permisiva, o quite el RLS un rato para depurar, el grant ya está puesto.
--
--        tabla          Betangar  flotamax-demo  FLOTILLA  VIDECA
--        alertas_log     grant       grant        (ya)      —
--        cumple_log      grant       grant        (ya)      —
--        usuarios_app    grant       grant        (ya)      —
--        licencias        —          grant        (ya)      —      ← acá ya estaba
--
-- ⛔ Comprobado ANTES, en vivo con la anon key y sin sesión:
--        alertas_log   638 filas reales → anon lee 0
--        cumple_log      4 filas reales → anon lee 0
--        usuarios_app    9 filas reales → anon lee 0
--   Las tres tienen datos y devuelven CERO: eso prueba que el RLS las corta. Con
--   una tabla vacía no se probaría nada ([[norma-test-que-pasa-por-el-motivo-equivocado]]).
--   Y como ya estaban bloqueadas, ninguna página anónima puede depender de ellas:
--   si dependiera, hoy estaría rota. Verificado además que no las nombra ninguna.
--
-- `licencias` acá ya era solo `postgres`/`service_role` — se incluye por si acaso;
-- el revoke sobre ella es un no-op. Se consulta por RPC, no por tabla.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare r record; n int := 0;
begin
  for r in
    select c.oid::regclass as t
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relname in ('alertas_log', 'cumple_log', 'licencias', 'usuarios_app')
  loop
    execute format('revoke all on table %s from anon', r.t);
    n := n + 1;
  end loop;
  if n <> 4 then
    raise exception 'Esperaba 4 tablas y encontré %', n;
  end if;
end $$;

commit;

-- ── Qué quedó ─────────────────────────────────────────────────────────────────
select c.relname,
       has_table_privilege('anon',          c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as oficina_lee,
       c.relrowsecurity as rls
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
 where ns.nspname = 'public'
   and c.relname in ('alertas_log', 'cumple_log', 'licencias', 'usuarios_app')
 order by c.relname;
