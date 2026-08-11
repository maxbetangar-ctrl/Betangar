-- ═══════════════════════════════════════════════════════════════════════════════
-- `avisos_unidad` — la parte de OFICINA: crear, listar y quitar un aviso
-- 2026-08-11 · va en las 4 bases (Betangar + los 3 clones vivos)
--
-- EL PROBLEMA QUE RESUELVE
--   El canal existe desde el 24/07 y se usó UNA vez, porque **un aviso solo se
--   podía crear escribiendo SQL**. Una pieza sin por dónde usarla está muerta.
--
-- ⛔ POR QUÉ NO ALCANZA CON DARLE LA TABLA A `authenticated`
--   El CHOFER TAMBIÉN ES `authenticated`: `chofer.html` hace `signInWithPassword`
--   con el usuario sintético de la unidad. Abrir la tabla a `authenticated` le
--   daría a cada chofer los avisos de TODAS las unidades — que es exactamente lo
--   que el diseño original evitaba. La tabla sigue cerrada a todo el mundo.
--
--   Así que la oficina entra por RPC, igual que el chofer, pero por su propia
--   puerta y con el rol comprobado EN EL SERVIDOR: `app_rol()` lee de
--   `btg_usuarios` por `auth.uid()`. Los logins de unidad NO están en esa tabla
--   (verificado: 0 en las 4 bases), así que un chofer da NULL y no pasa.
--   [[norma-authenticated-no-es-staff]] [[norma-seguridad-dos-niveles]]
--
--   Y `creado_por` NO viene del cliente: se saca del `btg_usuarios` de quien
--   llama. Un dato de auditoría que lo escribe el que se audita no sirve.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

-- Quién administra avisos. Es un mensaje de ADMINISTRACIÓN a la unidad.
create or replace function public.aviso_gestion_permitida()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce(public.app_rol() in
    ('superadmin','admin','directivo','operativo','operador','supervisor'), false);
$$;

-- LISTAR (oficina). Si no tiene permiso devuelve VACÍO, no error: la pantalla
-- simplemente no muestra nada y no filtra por el mensaje de excepción.
create or replace function public.avisos_listar()
returns table(id bigint, cam text, titulo text, mensaje text, hasta date,
              creado_por text, created_at timestamptz, vigente boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select a.id, a.cam, a.titulo, a.mensaje, a.hasta, a.creado_por, a.created_at,
         (a.hasta >= ((now() at time zone 'America/Caracas')::date)) as vigente
  from public.avisos_unidad a
  where public.aviso_gestion_permitida()
  order by (a.hasta >= ((now() at time zone 'America/Caracas')::date)) desc,
           a.hasta desc, a.created_at desc
  limit 200;
$$;

-- CREAR. Valida en el servidor, no en la pantalla: la pantalla se puede saltar.
create or replace function public.aviso_crear(
  p_cam text, p_titulo text, p_mensaje text, p_hasta date)
returns bigint language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v_id bigint;
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_quien text;
begin
  if not public.aviso_gestion_permitida() then
    raise exception 'No tenés permiso para mandar avisos a las unidades';
  end if;
  if coalesce(trim(p_cam), '') = '' then
    raise exception 'Falta la unidad';
  end if;
  if coalesce(trim(p_mensaje), '') = '' then
    raise exception 'El aviso no puede ir vacío';
  end if;
  if length(trim(p_mensaje)) > 500 then
    raise exception 'El mensaje es muy largo (máximo 500 caracteres)';
  end if;
  if length(coalesce(trim(p_titulo), '')) > 60 then
    raise exception 'El título es muy largo (máximo 60 caracteres)';
  end if;
  -- Un aviso que ya nació vencido no lo ve nadie, y uno eterno deja de leerse.
  if p_hasta is null or p_hasta < v_hoy then
    raise exception 'La fecha de vencimiento no puede ser anterior a hoy';
  end if;
  if p_hasta > v_hoy + 90 then
    raise exception 'Un aviso no puede durar más de 90 días';
  end if;

  -- Quién lo mandó lo dice el SERVIDOR, no el cliente.
  select coalesce(nullif(trim(u.nombre), ''), u.usuario, u.email, 'oficina')
    into v_quien
    from public.btg_usuarios u
   where u.auth_user_id = auth.uid()
   limit 1;

  insert into public.avisos_unidad(cam, titulo, mensaje, hasta, creado_por)
  values (trim(p_cam),
          nullif(trim(coalesce(p_titulo, '')), ''),
          trim(p_mensaje),
          p_hasta,
          coalesce(v_quien, 'oficina'))
  returning id into v_id;
  return v_id;
end $$;

-- QUITAR. Borra de verdad: un aviso retirado no tiene por qué quedar en pantalla.
-- Devuelve false si no existía (o si no hay permiso), para que la pantalla lo diga.
create or replace function public.aviso_borrar(p_id bigint)
returns boolean language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not public.aviso_gestion_permitida() then
    raise exception 'No tenés permiso para quitar avisos';
  end if;
  delete from public.avisos_unidad where id = p_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- La tabla sigue cerrada. Solo se puede ejecutar la RPC, y cada una comprueba el rol.
revoke execute on function public.aviso_gestion_permitida()                 from public;
revoke execute on function public.avisos_listar()                            from public;
revoke execute on function public.aviso_crear(text, text, text, date)        from public;
revoke execute on function public.aviso_borrar(bigint)                       from public;
grant  execute on function public.aviso_gestion_permitida()                  to authenticated;
grant  execute on function public.avisos_listar()                            to authenticated;
grant  execute on function public.aviso_crear(text, text, text, date)        to authenticated;
grant  execute on function public.aviso_borrar(bigint)                       to authenticated;

-- ⛔ `anon` no: solo puede leer SU aviso por `aviso_unidad(p_cam)`, como antes.
--    Y hay que REVOCARLE EXPLÍCITAMENTE, no basta con `from public`: si la base tiene
--    un `grant execute on all functions ... to anon` (VIDECA lo tiene), ese grant es
--    DIRECTO y sobrevive al revoke de PUBLIC. Se comprobó en vivo: recién creadas, las
--    3 RPC de gestión ya eran ejecutables por `anon` en VIDECA.
--    [[seguridad-regresion-grant-anon-firma]] — toda función nueva nace expuesta ahí.
revoke execute on function public.aviso_gestion_permitida()                  from anon;
revoke execute on function public.avisos_listar()                            from anon;
revoke execute on function public.aviso_crear(text, text, text, date)        from anon;
revoke execute on function public.aviso_borrar(bigint)                       from anon;

commit;

-- ── Qué quedó (se devuelve: una migración que no hizo nada tiene que NOTARSE) ──
select
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.proname in ('aviso_gestion_permitida','avisos_listar','aviso_crear','aviso_borrar')
       and p.prosecdef)                                                        as rpc_security_definer,
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema='public' and grantee='anon'
       and routine_name in ('avisos_listar','aviso_crear','aviso_borrar'))      as anon_puede_gestionar,
  (select count(*)::int from information_schema.role_table_grants
     where table_schema='public' and table_name='avisos_unidad'
       and grantee in ('anon','authenticated'))                                 as tabla_expuesta;
