-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ARIANNY MORÁN — la auditora externa entra al sistema (2026-08-11)
--
-- Ya estaba en `empleados` como E055 «ARIANNY MORAN», cargo «Auditora», con la cédula cargada y
-- **nada más**: sin nombre completo, sin fecha de nacimiento, sin correo y sin teléfono. Acá se
-- completa la ficha Y se le crea el acceso con el rol `auditor` (solo lectura), que nace en
-- `rol_revisor_y_auditor_solo_lectura_2026-08-11.sql`.
--
-- ⚠️ Al crear un `auth.users` POR SQL hay que poner en '' (NO en NULL) los campos de token, o el
-- login devuelve «Database error querying schema». Y hace falta su fila en `auth.identities`.
-- Ya costó una sesión entera con el usuario de Alejandra — no repetirlo.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _u_log(paso text, detalle text, n int) on commit preserve rows;
truncate _u_log;

-- ── 1) La ficha de empleada: se completa lo que faltaba ──────────────────────────────────────
-- La cédula ya venía normalizada (`cedula_canon` = V20843404) y coincide con la que dio ella.
-- El TIPO va en columna aparte y el número aparte [[norma-identificacion-tipo-aparte-y-normalizada]].
with e as (
  update public.empleados set
    nombre      = 'ARIANNY ANYELINA MORAN FINOL',
    cedula_tipo = 'V',
    fnac        = date '1991-01-05',
    email       = 'empresascastilloadm@gmail.com',
    tel         = '04141641630',
    whatsapp    = '04141641630',
    updated_at  = now()
  where id = 'E055'
  returning 1
) insert into _u_log select '1. empleados E055', 'ficha completada', count(*)::int from e;

-- ── 2) El acceso ─────────────────────────────────────────────────────────────────────────────
-- El login de Betangar arma el correo como `usuario@betangar.local` (no son buzones reales; el
-- correo de verdad queda en la ficha de empleada y en `btg_usuarios.email`).
do $mig$
declare
  v_uid   uuid;
  v_user  text := 'arianny';
  v_mail  text := 'arianny@betangar.local';
  v_pass  text := 'Btg.Auditoria2026';
  v_iid   uuid;
begin
  select id into v_uid from auth.users where email = v_mail;

  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_mail, extensions.crypt(v_pass, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('usuario', v_user, 'nombre', 'Arianny Morán', 'rol', 'auditor'),
      '', '', '', '', '', '', '', ''
    );
    insert into _u_log values ('2. auth.users', 'creado '||v_mail, 1);
  else
    update auth.users
       set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           raw_user_meta_data = jsonb_build_object('usuario', v_user, 'nombre', 'Arianny Morán', 'rol', 'auditor'),
           updated_at = now()
     where id = v_uid;
    insert into _u_log values ('2. auth.users', 'ya existía, clave puesta', 1);
  end if;

  -- La identidad: sin esta fila el login falla aunque el usuario exista.
  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    v_iid := gen_random_uuid();
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_iid, v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_mail, 'email_verified', true, 'phone_verified', false),
            'email', now(), now(), now());
    insert into _u_log values ('2b. auth.identities', 'creada', 1);
  else
    insert into _u_log values ('2b. auth.identities', 'ya existía', 0);
  end if;

  -- ── 3) La ficha del sistema ────────────────────────────────────────────────────────────────
  -- `exige_token` en false: no tiene un solo botón que borre ni edite, así que no hay nada que
  -- autorizarle. El candado que la define es que su rol NO está en ninguna política de escritura.
  insert into public.btg_usuarios (usuario, nombre, email, rol, activo, exige_token, auth_user_id)
  values (v_user, 'Arianny Morán', 'empresascastilloadm@gmail.com', 'auditor', true, false, v_uid)
  on conflict (usuario) do update
     set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol,
         activo = true, exige_token = false, auth_user_id = excluded.auth_user_id;
  insert into _u_log values ('3. btg_usuarios', 'rol auditor (solo lectura)', 1);
end $mig$;

-- ── 4) Control ───────────────────────────────────────────────────────────────────────────────
insert into _u_log
select '4. control', 'usuario '||u.usuario||' · rol '||u.rol||' · auth '||(case when u.auth_user_id is null then 'FALTA' else 'ok' end)
              ||' · identidad '||(select count(*) from auth.identities i where i.user_id = u.auth_user_id)::text, 1
  from public.btg_usuarios u where u.usuario = 'arianny';

insert into _u_log
select '4. control empleado', 'E055 '||nombre||' · '||coalesce(cedula_tipo,'?')||'-'||coalesce(cedula_canon,'?')
              ||' · nac '||coalesce(fnac::text,'?')||' · '||coalesce(email,'?'), 1
  from public.empleados where id='E055';

select * from _u_log;
