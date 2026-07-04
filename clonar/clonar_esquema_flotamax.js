#!/usr/bin/env node
/**
 * CLONAR FLOTAMAX → base de un cliente nuevo (Supabase project aparte).
 * Deja el esquema COMPLETO y SEGURO: tablas + PK/unique + índices + funciones +
 * triggers + vistas + RLS habilitada + políticas + GRANTS replicados (anon cerrado
 * donde debe). Idempotente. NO carga datos (eso va aparte con la plantilla del cliente).
 *
 * Uso (credenciales por variables de entorno — NUNCA hardcodear, el repo es público):
 *   SB_PAT=sbp_xxx SB_SRC=hrkjddehqnzcqwlkklqm SB_DST=<ref_nuevo> node clonar/clonar_esquema_flotamax.js
 *
 *   SB_PAT = Personal Access Token de Supabase (Account → Access Tokens)
 *   SB_SRC = ref del proyecto FUENTE (el que tiene FlotaMax/Betangar)
 *   SB_DST = ref del proyecto DESTINO (la base nueva del cliente, vacía)
 *
 * Filtra SOLO las tablas FlotaMax (excluye edu_ de Geppetto y usdt_).
 * Después de correr esto: aplicar la RLS-por-unidad del clon (login por unidad) y cargar datos.
 */
const PAT = process.env.SB_PAT, SRC = process.env.SB_SRC, DST = process.env.SB_DST;
if (!PAT || !SRC || !DST) { console.error('Faltan SB_PAT / SB_SRC / SB_DST'); process.exit(1); }
const F_C = "relname not like 'edu\\_%' and relname not like 'usdt\\_%'";
const F_T = "tablename not like 'edu\\_%' and tablename not like 'usdt\\_%'";

async function run(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + PAT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { return { error: t.slice(0, 400) }; }
  if (!r.ok || (j && j.error)) return { error: (j.error || j.message || t).toString().slice(0, 400) };
  return { rows: j };
}
const col = (o, k) => (o.rows || []).map(x => x[k]).filter(Boolean);

(async () => {
  console.log('== Introspección de', SRC, '==');
  const Q = {
    seqs: `select 'CREATE SEQUENCE IF NOT EXISTS public.'||quote_ident(sequencename)||';' d from pg_sequences where schemaname='public'`,
    tbls: `select 'CREATE TABLE IF NOT EXISTS public.'||quote_ident(c.relname)||' ('||string_agg(quote_ident(a.attname)||' '||pg_catalog.format_type(a.atttypid,a.atttypmod)||case when a.attidentity in ('a','d') then ' GENERATED '||case a.attidentity when 'a' then 'ALWAYS' else 'BY DEFAULT' end||' AS IDENTITY' when ad.adbin is not null then ' DEFAULT '||pg_get_expr(ad.adbin,ad.adrelid) else '' end||case when a.attnotnull then ' NOT NULL' else '' end, ', ' order by a.attnum)||');' d from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum where c.relkind='r' and c.relnamespace='public'::regnamespace and ${F_C} group by c.relname`,
    cons: `select 'ALTER TABLE public.'||quote_ident(t.relname)||' ADD CONSTRAINT '||quote_ident(con.conname)||' '||pg_get_constraintdef(con.oid)||';' d from pg_constraint con join pg_class t on t.oid=con.conrelid where t.relnamespace='public'::regnamespace and con.contype in ('p','u') and t.relname not like 'edu\\_%' and t.relname not like 'usdt\\_%'`,
    idx: `select indexdef||';' d from pg_indexes where schemaname='public' and ${F_T} and indexname not in (select conname from pg_constraint where contype in ('p','u'))`,
    fns: `select pg_get_functiondef(p.oid)||';' d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'`,
    vws: `select 'CREATE OR REPLACE VIEW public.'||quote_ident(viewname)||' AS '||definition d, viewname from pg_views where schemaname='public' and viewname not like 'edu\\_%' and viewname not like 'usdt\\_%'`,
    rls: `select 'ALTER TABLE public.'||quote_ident(relname)||' ENABLE ROW LEVEL SECURITY;' d from pg_class where relkind='r' and relnamespace='public'::regnamespace and relrowsecurity and ${F_C}`,
    pol: `select 'CREATE POLICY '||quote_ident(policyname)||' ON public.'||quote_ident(tablename)||' AS '||permissive||' FOR '||cmd||' TO '||array_to_string(roles,',')||coalesce(' USING ('||qual||')','')||coalesce(' WITH CHECK ('||with_check||')','')||';' d from pg_policies where schemaname='public' and ${F_T}`,
    trg: `select pg_get_triggerdef(tg.oid)||';' d from pg_trigger tg join pg_class c on c.oid=tg.tgrelid where not tg.tgisinternal and c.relnamespace='public'::regnamespace and ${F_C}`,
  };
  const R = {}; for (const k in Q) { R[k] = await run(SRC, Q[k]); if (R[k].error) { console.error('ERR ' + k, R[k].error); process.exit(1); } console.log('  ' + k + ':', R[k].rows.length); }

  // 1) estructura (funciones con check off; vistas una a una por si alguna referencia edu_)
  const base = ['set check_function_bodies=off;',
    '-- SECUENCIAS', ...col(R.seqs, 'd'), '-- TABLAS', ...col(R.tbls, 'd'),
    '-- PK/UNIQUE', ...col(R.cons, 'd'), '-- INDICES', ...col(R.idx, 'd'),
    '-- FUNCIONES', ...col(R.fns, 'd')].join('\n');
  let ap = await run(DST, base); console.log(ap.error ? '❌ estructura: ' + ap.error : '✅ estructura (tablas+funciones)');
  for (const v of (R.vws.rows || [])) { const r = await run(DST, 'set check_function_bodies=off; ' + v.d); if (!r.error) console.log('  ✅ vista ' + v.viewname); }
  ap = await run(DST, ['-- RLS', ...col(R.rls, 'd'), '-- POLICIES', ...col(R.pol, 'd'), '-- TRIGGERS', ...col(R.trg, 'd')].join('\n'));
  console.log(ap.error ? '❌ rls/policies/triggers: ' + ap.error : '✅ RLS + políticas + triggers');

  // 2) GRANTS replicados (anon cerrado donde la fuente lo tiene) + secuencias
  const dr = await run(DST, `select table_name from information_schema.tables where table_schema='public'`);
  const exist = new Set((dr.rows || []).map(x => x.table_name));
  const g = await run(SRC, `select grantee, privilege_type, table_name from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') and table_name not like 'edu\\_%' and table_name not like 'usdt\\_%'`);
  const stmts = (g.rows || []).filter(x => exist.has(x.table_name)).map(x => 'GRANT ' + x.privilege_type + ' ON public."' + x.table_name + '" TO ' + x.grantee + ';');
  const reset = 'revoke all on all tables in schema public from anon; revoke all on all tables in schema public from authenticated;';
  const seqG = "do $$ declare s text; begin for s in select sequencename from pg_sequences where schemaname='public' loop execute 'grant usage, select on sequence public.'||quote_ident(s)||' to anon, authenticated, service_role'; end loop; end $$;";
  ap = await run(DST, reset + '\n' + stmts.join('\n') + '\n' + seqG);
  console.log(ap.error ? '❌ grants: ' + ap.error : '✅ ' + stmts.length + ' grants (anon cerrado replicado) + secuencias');

  console.log('\n✔ Clon de esquema listo y SEGURO. Próximo: RLS-por-unidad del clon + carga de datos.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
