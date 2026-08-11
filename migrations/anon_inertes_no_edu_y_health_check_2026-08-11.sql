-- ═══════════════════════════════════════════════════════════════════════════════
-- Los grants inertes que quedaban en Betangar (los que NO son de los colegios)
-- + la política muerta de `health_check`
-- 2026-08-11
--
-- ⛔ LO PRIMERO, Y ES LO QUE DEFINE EL ALCANCE: esta base NO es solo de Betangar.
--    Aloja también **Geppetto y Ranita** (`geppetto-app` y `ranita-app` apuntan al
--    mismo proyecto). De los 51 grants inertes, **35 son tablas `edu_*` que usan
--    las apps de los colegios**, y el `CLAUDE.md` del repo lo dice sin rodeos:
--    «El mismo Supabase aloja Geppetto (tablas `edu_*`): NO TOCARLAS».
--    **No se tocan.** Ni las 35 en uso ni las 16 que no aparecen en ningún archivo:
--    son de otro producto y se revisan desde su repo, con su gente mirando.
--
--    Un barrido sobre el repo `Betangar/` habría dicho que 16 tablas `edu_*` «no
--    las usa nadie». Habría sido falso: falta mirar los repos de los colegios.
--
-- QUEDAN CUATRO, y ninguna es de los colegios:
--   `app_secretos_internos`  guarda `binance_sync_key`, el secreto con el que se
--                            autentica el sync de Binance. Lo lee `geppetto-app`
--                            con SUPABASE_SERVICE_ROLE_KEY, desde el servidor.
--                            **Una tabla de secretos con grants a `anon`.**
--   `calendario_fiscal`      la usa `app.js` (oficina, autenticada).
--   `seniat_retenciones`     la usa `app.js` (oficina, autenticada).
--   `wa_autoreply_log`       la escribe una Edge Function (service_role).
--
--   Ninguna la toca una página anónima, y ninguna necesita `anon` para nada.
--
-- ⛔ COMPROBADO EN VIVO ANTES, con la anon key y sin sesión — y con tablas que
--    TIENEN datos, que es lo único que prueba algo:
--        calendario_fiscal      51 filas reales → anon lee 0
--        wa_autoreply_log       48 filas reales → anon lee 0
--        seniat_retenciones      2 filas reales → anon lee 0
--        app_secretos_internos   1 fila  real   → anon lee 0
--    Están bloqueadas por el RLS. Pero el candado que las detiene es OTRO: el día
--    que alguien agregue una política permisiva, el grant ya está puesto.
--    [[norma-test-que-pasa-por-el-motivo-equivocado]] [[norma-secreto-no-vive-donde-se-escribe-historial]]
--
-- Y `health_check`: tiene política para `anon` y NINGÚN grant, así que responde 401
-- y la política no se evalúa nunca. Quien la consulta es el **panel de salud de la
-- oficina** (`app.js`), que va autenticado y escribe con `SESION.nombre`. La
-- política de `anon` es peso muerto: se quita.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare r record; n int := 0;
begin
  for r in
    select c.oid::regclass as t
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relname in ('app_secretos_internos','calendario_fiscal','seniat_retenciones','wa_autoreply_log')
  loop
    execute format('revoke all on table %s from anon', r.t);
    n := n + 1;
  end loop;
  if n <> 4 then raise exception 'Esperaba 4 tablas y encontré %', n; end if;
end $$;

-- La política muerta de health_check (para `anon`, sin grant que la habilite).
do $$
declare r record; n int := 0;
begin
  for r in
    select policyname from pg_policies
     where schemaname='public' and tablename='health_check' and 'anon' = any(roles)
  loop
    execute format('drop policy %I on public.health_check', r.policyname);
    n := n + 1;
  end loop;
  raise notice 'políticas anon quitadas de health_check: %', n;
end $$;

commit;

-- ── Qué quedó ─────────────────────────────────────────────────────────────────
select c.relname,
       has_table_privilege('anon',          c.oid, 'select') as anon,
       has_table_privilege('authenticated', c.oid, 'select') as oficina,
       (select count(*)::int from pg_policies p
         where p.schemaname='public' and p.tablename=c.relname and 'anon' = any(p.roles)) as politicas_anon
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
 where ns.nspname='public'
   and c.relname in ('app_secretos_internos','calendario_fiscal','seniat_retenciones','wa_autoreply_log','health_check')
 order by c.relname;
