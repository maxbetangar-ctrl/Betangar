-- chofer_anon_no_delete_2026-07-17.sql  (Flotilla mcvizzknpqrggohbohcw + base compartida hrkjddehqnzcqwlkklqm)
-- Espejar en Betangar (misma SQL). Aplicar en AMBAS bases.
--
-- PASO 0 del endurecimiento de tablas del chofer. Hoy las policies anon son ALL + qual=true → un anon
-- con la llave pública puede SELECT/INSERT/UPDATE/**DELETE** cualquier fila de cualquier unidad.
-- Verificado (chofer.html Flotilla y Betangar): el chofer NUNCA hace .delete() de Supabase (0 ocurrencias);
-- solo insert/update/upsert/select. La oficina entra authenticated (policies btg_auth_all propias, no se tocan).
-- => Se le quita DELETE a anon (ALL → SELECT/INSERT/UPDATE) y se dedupe (había policies repetidas).
-- NO acota por unidad todavía (eso es el Paso 1/2, requiere encender el login por unidad).
-- Idempotente y seguro: solo dropea policies PURAS de anon/public; deja intactas las de authenticated.

do $$
declare
  t text;
  p record;
  tbls text[] := array['asistencia','checklist','combustible_mediciones','flota_estado',
                       'km_data','porteria','rutas_estado','viajes_chofer'];
begin
  foreach t in array tbls loop
    if to_regclass('public.'||t) is null then continue; end if;
    -- 1) borrar SOLO las policies puras de anon/public (las de authenticated quedan intactas)
    for p in
      select policyname from pg_policies
      where schemaname='public' and tablename=t and roles::text in ('{anon}','{public}')
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    -- 2) recrear acceso anon SIN delete (mismo alcance permisivo de antes, menos DELETE)
    execute format('create policy chofer_anon_select on public.%I for select to anon using (true)', t);
    execute format('create policy chofer_anon_insert on public.%I for insert to anon with check (true)', t);
    execute format('create policy chofer_anon_update on public.%I for update to anon using (true) with check (true)', t);
    -- 3) belt-and-suspenders a nivel grant: quitar el privilegio DELETE de la tabla a anon
    execute format('revoke delete on public.%I from anon', t);
  end loop;
end $$;
