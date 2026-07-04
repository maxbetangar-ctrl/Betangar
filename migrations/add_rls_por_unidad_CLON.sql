-- ════════════════════════════════════════════════════════════════════════════
-- RLS POR UNIDAD — SOLO PARA CLONES CON LOGIN DE CHOFER (FlotaMax).
--
-- ⛔ NO CORRER EN BETANGAR (aseo). Rompe a los 12 choferes JAC, que entran SIN login
--    (anon). Esta migración es para el Supabase de un CLIENTE NUEVO cuyo chofer.html
--    tiene BTG_CHOFER_CONFIG.login=true y cuyas unidades se provisionan con la edge
--    function unidad_provisionar (que deja app_metadata.cam en cada cuenta).
--
-- Efecto: cada UNIDAD (autenticada, con app_metadata.cam) solo ve/escribe SUS filas;
--    la OFICINA (usuarios con rol en btg_usuarios → app_rol() no nulo) ve/escribe todo;
--    anon queda revocado. Aísla los datos de cada unidad = requisito para vender.
--
-- Requisitos en el clon (ya vienen si es clon completo de Betangar):
--   • función public.app_rol()  (de add_rls_c2_visualizador_readonly.sql)
--   • cuentas de unidad creadas por unidad_provisionar (app_metadata.cam)
-- Correr en el SQL Editor del proyecto Supabase DEL CLIENTE.
-- ════════════════════════════════════════════════════════════════════════════

-- (1) Tablas con columna de unidad: aislamiento por unidad + oficina ve todo.
do $$
declare
  i int;
  t text; col text; q text; qc text; cond text;
  tbls text[] := array['viajes_chofer','checklist','entregas','km_data','flota_estado'];
  cols text[] := array['cam','cam','cam','cam','unidad'];
begin
  for i in 1..array_length(tbls,1) loop
    t := tbls[i]; col := cols[i];
    if exists(select 1 from information_schema.tables
              where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      q := quote_ident(t); qc := quote_ident(col);
      cond := 'app_rol() is not null or '||qc||' = (auth.jwt()->''app_metadata''->>''cam'')';
      execute 'alter table public.'||q||' enable row level security';
      execute 'drop policy if exists uni_self_sel on public.'||q;
      execute 'drop policy if exists uni_self_ins on public.'||q;
      execute 'drop policy if exists uni_self_upd on public.'||q;
      execute 'drop policy if exists uni_self_del on public.'||q;
      execute 'create policy uni_self_sel on public.'||q||' for select to authenticated using ('||cond||')';
      execute 'create policy uni_self_ins on public.'||q||' for insert to authenticated with check ('||cond||')';
      execute 'create policy uni_self_upd on public.'||q||' for update to authenticated using ('||cond||') with check ('||cond||')';
      execute 'create policy uni_self_del on public.'||q||' for delete to authenticated using ('||cond||')';
      execute 'revoke all on public.'||q||' from anon';
    end if;
  end loop;
end $$;

-- (2) Tablas del chofer sin columna de unidad: cerrar anon; permitir authenticated
--     (oficina + unidades). Afinar por cliente si se quiere aislar también estas.
do $$
declare t text; q text;
  s text[] := array['combustible_mediciones','porteria'];
begin
  foreach t in array s loop
    if exists(select 1 from information_schema.tables
              where table_schema='public' and table_name=t and table_type='BASE TABLE') then
      q := quote_ident(t);
      execute 'alter table public.'||q||' enable row level security';
      execute 'drop policy if exists uni_auth_all on public.'||q;
      execute 'create policy uni_auth_all on public.'||q||' for all to authenticated using (true) with check (true)';
      execute 'revoke all on public.'||q||' from anon';
    end if;
  end loop;
end $$;

-- VERIFICAR (con una cuenta de unidad real del clon, ver receta abajo):
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and policyname like 'uni_%' order by tablename, cmd;
--
-- RECETA de prueba end-to-end (cuando el clon tenga ≥2 unidades provisionadas):
--   1. Login como unidad A (signInWithPassword) → JWT.
--   2. GET viajes_chofer con ese JWT → solo debe traer filas de la unidad A.
--   3. INSERT viajes_chofer con cam de la unidad B → debe fallar (403 / 0 filas).
--   4. Login como usuario de OFICINA → debe ver TODAS las unidades.
--
-- ROLLBACK (volver a abrir a authenticated sin aislamiento):
--   do $$ declare t text; q text; s text[]:=array['viajes_chofer','checklist','entregas','km_data','flota_estado'];
--   begin foreach t in array s loop q:=quote_ident(t);
--     execute 'drop policy if exists uni_self_sel on public.'||q;
--     execute 'drop policy if exists uni_self_ins on public.'||q;
--     execute 'drop policy if exists uni_self_upd on public.'||q;
--     execute 'drop policy if exists uni_self_del on public.'||q;
--     execute 'create policy uni_auth_all on public.'||q||' for all to authenticated using (true) with check (true)';
--   end loop; end $$;
