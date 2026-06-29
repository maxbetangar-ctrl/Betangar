-- ════════════════════════════════════════════════════════════════════════════
-- HARDENING FINO (ISO 27001) — cierra los pendientes "secundarios" de seguridad:
--   1) bnc_actualizar_config era EJECUTABLE por anon → cualquiera con la anon key podía
--      sobrescribir las credenciales del banco (integridad). Se revoca a anon y se deja solo a
--      usuarios AUTENTICADOS (el editor de config BNC en la app corre con la sesión del superadmin).
--   2) nomina_historial: asegurar que el anon NO lo lea (la app lo lee con sesión autenticada).
-- Idempotente y segura: usa DO/loops para no romper si la firma/objeto ya está endurecido.
-- Correr en Supabase SQL Editor. NO requiere redeploy del frontend.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) bnc_actualizar_config: revocar anon en TODAS sus sobrecargas (cualquiera sea la firma).
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc where proname = 'bnc_actualizar_config' loop
    execute 'revoke execute on function '||r.sig||' from anon';
    execute 'grant execute on function '||r.sig||' to authenticated';
  end loop;
end $$;

-- 2) nomina_historial: quitar cualquier acceso del anon (RLS por rol ya cubre la lectura por
--    oficina; esto cierra el grant residual a anon que detectó el levantamiento). La app usa la
--    sesión autenticada, así que no se rompe nada.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='nomina_historial') then
    execute 'revoke all on table public.nomina_historial from anon';
  end if;
end $$;

-- NOTA: las "vistas SECURITY DEFINER" (p. ej. bnc_config_estado) deben verificarse en vivo:
--   select relname, reloptions from pg_class where relkind='v' and relnamespace='public'::regnamespace;
-- y, de ser necesario, recrearlas con  ... with (security_invoker = true)  para que respeten RLS.
-- (bnc_config_estado ya enmascara working_key; revisar que corra como invoker.)
