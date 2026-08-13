-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ALEJANDRO CASTILLO — socio, entra como VISOR (2026-08-13)
--
-- Es el socio del «FONDO SOCIEDAD ASEO EN CUENTA ALEJANDRO» (US$ 26.445 al 08/08/2026, ver
-- [[betangar-financiamiento-camiones-auto-union]]). NO es empleado: **no se toca `empleados`**,
-- porque esa tabla es la nómina y sumarlo ahí le mueve el conteo a RRHH, a las anomalías y a
-- los cálculos de nómina.
--
-- «Lo mismo de Jonaz»: Jonaz NO tiene usuario en el sistema — existe solo como número que
-- recibe TODO ingreso (`bnc-webhook` y el aviso de abono en `app.js`). Eso va aparte, en el
-- código; acá va el ACCESO, que Jonaz no tiene.
--
-- Rol `visualizador` = el «visor» que ya existe (`betangarvisor`): dashboard, informe, entregas,
-- reporte, abonos, banco, usd, financiero, stats, ranking, rentabilidad, contratos, galería.
-- Solo lectura. No exige 2FA (doLogin solo lo obliga a superadmin/revisor/auditor/admin/rrhh).
--
-- ⚠️ Al crear un `auth.users` POR SQL hay que poner en '' (NO en NULL) los campos de token, o el
-- login devuelve «Database error querying schema». Y hace falta su fila en `auth.identities`.
-- Ya costó una sesión entera con el usuario de Alejandra — no repetirlo.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _u_log(paso text, detalle text, n int) on commit preserve rows;
truncate _u_log;

do $mig$
declare
  v_uid   uuid;
  v_user  text := 'alecastillo';
  v_mail  text := 'alecastillo@betangar.local';   -- el login arma usuario@betangar.local
  v_pass  text := 'Btg.Castillo2026';
  v_nom   text := 'Alejandro Castillo';
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
      jsonb_build_object('usuario', v_user, 'nombre', v_nom, 'rol', 'visualizador'),
      '', '', '', '', '', '', '', ''
    );
    insert into _u_log values ('1. auth.users', 'creado '||v_mail, 1);
  else
    update auth.users
       set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           raw_user_meta_data = jsonb_build_object('usuario', v_user, 'nombre', v_nom, 'rol', 'visualizador'),
           updated_at = now()
     where id = v_uid;
    insert into _u_log values ('1. auth.users', 'ya existía, clave puesta', 1);
  end if;

  -- La identidad: sin esta fila el login falla aunque el usuario exista.
  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    v_iid := gen_random_uuid();
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_iid, v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_mail, 'email_verified', true, 'phone_verified', false),
            'email', now(), now(), now());
    insert into _u_log values ('1b. auth.identities', 'creada', 1);
  else
    insert into _u_log values ('1b. auth.identities', 'ya existía', 0);
  end if;

  -- La ficha del sistema. `app_rol()` lee el rol DE ACÁ, no del token: sin esta fila la RLS no
  -- lo reconoce y no vería nada. `exige_token` en false: no tiene un botón que borre ni edite.
  -- El correo es el REAL (alecastillo21@gmail.com); el @betangar.local es solo la llave de login.
  insert into public.btg_usuarios (usuario, nombre, email, rol, activo, exige_token, auth_user_id)
  values (v_user, v_nom, 'alecastillo21@gmail.com', 'visualizador', true, false, v_uid)
  on conflict (usuario) do update
     set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol,
         activo = true, exige_token = false, auth_user_id = excluded.auth_user_id;
  insert into _u_log values ('2. btg_usuarios', 'rol visualizador (solo lectura)', 1);
end $mig$;

-- ── Control ──────────────────────────────────────────────────────────────────────────────────
insert into _u_log
select '3. control', 'usuario '||u.usuario||' · rol '||u.rol||' · auth '||(case when u.auth_user_id is null then 'FALTA' else 'ok' end)
              ||' · identidad '||(select count(*) from auth.identities i where i.user_id = u.auth_user_id)::text
              ||' · wa '||coalesce(u.wa,'(pendiente)'), 1
  from public.btg_usuarios u where u.usuario = 'alecastillo';

select * from _u_log;
