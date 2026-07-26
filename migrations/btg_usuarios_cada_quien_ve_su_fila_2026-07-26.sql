-- ════════════════════════════════════════════════════════════════════════════
-- CADA USUARIO VE SOLO SU FILA   (2026-07-26)
--
-- CAUSA: salió revisando el borrado sin token. `btg_usuarios` tenía `SELECT true` para todo
-- `authenticated`: cualquiera que entrara podía listar TODOS los usuarios con su rol.
-- No hay claves ahí, pero es el mapa de quién es quién — le dice a un curioso a quién
-- suplantar y quién tiene permiso de qué.
--
-- POR QUÉ NO ROMPE NADA: se verificó en el código de las 4 apps que `btg_usuarios` se lee
-- SOLO al entrar y SOLO la fila propia (`.eq('auth_user_id', <el mío>)`). Nadie lista usuarios.
-- Se deja ver a todos a superadmin/admin/auditor para que la administración de usuarios
-- siga siendo posible.
--
-- OJO: `app_rol()` es SECURITY DEFINER, así que NO se muerde la cola con esta política
-- (si leyera la tabla con RLS puesta, se colgaría en recursión).
--
-- Verificado en Betangar: el usuario `rrhh1` pasó de ver 17 filas a ver 1 (la suya), el rol
-- auditor sigue viendo las 17, y `anon` ni siquiera tiene privilegio sobre la tabla.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists btg_usuarios_read on public.btg_usuarios;
create policy btg_usuarios_read on public.btg_usuarios for select to authenticated
  using (
    auth_user_id = auth.uid()
    or app_rol() = any (array['superadmin','admin','auditor'])
  );
