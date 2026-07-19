-- ============================================================================
-- HARDENING DE SEGURIDAD (auditoría Betangar 2026-07-11) — PLANTILLA FlotaMax
-- CORRER ESTE ARCHIVO EN CADA CLON NUEVO (base nueva) para que nazca sin los defectos.
-- Genérico (NO toca nómina/alcaldía-lógica). Idempotente. Requiere app_rol() y btg_usuarios.
-- Ajustar la whitelist de roles 'office' si el cliente usa nombres de rol distintos.
-- ============================================================================

-- 1) Neutralizar RPC de escalada (aplicar_accion_aprobada): corría como owner saltando RLS y estaba
--    granted a authenticated. Código muerto pero explotable → revocar (o drop).
do $$ declare r record; begin
  for r in select oid::regprocedure sig from pg_proc where proname='aplicar_accion_aprobada' loop
    execute format('revoke execute on function %s from anon, authenticated, public', r.sig);
  end loop;
end $$;

-- 2) tokens_pendientes: cerrar el acceso total anon/authenticated. Insertar (pedir)=logueado;
--    APROBAR/usar/borrar = SOLO superadmin (aprobación server-authoritative de verdad).
do $$ declare p record; begin
  if exists(select 1 from information_schema.tables where table_schema='public' and table_name='tokens_pendientes') then
    for p in select policyname from pg_policies where tablename='tokens_pendientes' loop
      execute format('drop policy if exists %I on public.tokens_pendientes', p.policyname);
    end loop;
    create policy tok_sel on public.tokens_pendientes for select to authenticated using (true);
    create policy tok_ins on public.tokens_pendientes for insert to authenticated with check (true);
    create policy tok_upd_superadmin on public.tokens_pendientes for update to authenticated using (public.app_rol()='superadmin') with check (public.app_rol()='superadmin');
    create policy tok_del_superadmin on public.tokens_pendientes for delete to authenticated using (public.app_rol()='superadmin');
  end if;
end $$;

-- 3) planillas / gasoil / gasol (verdad del dinero: viajes, combustible → nómina y Utilidad Real):
--    escribir SOLO roles de oficina; leer logueados; borrar superadmin.
do $$
declare tbl text; p record;
  office text := $o$public.app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh'])$o$;
begin
  foreach tbl in array array['planillas','gasoil','gasol'] loop
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name=tbl) then
      execute format('alter table public.%I enable row level security', tbl);
      for p in select policyname from pg_policies where tablename=tbl loop
        execute format('drop policy if exists %I on public.%I', p.policyname, tbl);
      end loop;
      execute format('create policy sel_auth on public.%I for select to authenticated using (true)', tbl);
      execute format('create policy ins_office on public.%I for insert to authenticated with check (%s)', tbl, office);
      execute format('create policy upd_office on public.%I for update to authenticated using (%s) with check (%s)', tbl, office, office);
      execute format('create policy del_superadmin on public.%I for delete to authenticated using (public.app_rol()=$q$superadmin$q$)', tbl);
    end if;
  end loop;
end $$;

-- 4) entrega_registrar (si existe el módulo de entregas): no pisar una entrega CONFIRMADA (prueba legal)
--    y solo re-registrar si el token coincide (bloquea id adivinado por anon).
do $$ begin
  if exists(select 1 from information_schema.tables where table_schema='public' and table_name='entregas') then
    execute $fn$
    create or replace function public.entrega_registrar(p jsonb)
    returns text language plpgsql security definer set search_path = public as $body$
    declare v_id text := coalesce(p->>'id','');
    begin
      if v_id = '' then return null; end if;
      insert into public.entregas as e (
        id, cam, chofer, cliente, direccion, tipo, lat, lng, precision_gps,
        direccion_gps, foto_url, fecha, hora, estado, token,
        recibido_por, recibido_ci, recibido_at, confirm_via
      ) values (
        v_id, p->>'cam', p->>'chofer', p->>'cliente', p->>'direccion', p->>'tipo',
        nullif(p->>'lat','')::double precision, nullif(p->>'lng','')::double precision,
        nullif(p->>'precision_gps','')::double precision,
        p->>'direccion_gps', p->>'foto_url', nullif(p->>'fecha','')::date, p->>'hora',
        coalesce(nullif(p->>'estado',''),'entregada'), p->>'token',
        p->>'recibido_por', p->>'recibido_ci',
        nullif(p->>'recibido_at','')::timestamptz, p->>'confirm_via'
      )
      on conflict (id) do update set
        cliente=excluded.cliente, direccion=excluded.direccion, tipo=excluded.tipo,
        lat=excluded.lat, lng=excluded.lng, precision_gps=excluded.precision_gps,
        direccion_gps=excluded.direccion_gps, foto_url=excluded.foto_url, estado=excluded.estado,
        recibido_por=coalesce(excluded.recibido_por,e.recibido_por),
        recibido_ci=coalesce(excluded.recibido_ci,e.recibido_ci),
        recibido_at=coalesce(excluded.recibido_at,e.recibido_at),
        confirm_via=coalesce(excluded.confirm_via,e.confirm_via)
      where e.estado is distinct from 'confirmada' and e.token is not distinct from (p->>'token');
      return v_id;
    end; $body$;
    $fn$;
  end if;
end $$;
