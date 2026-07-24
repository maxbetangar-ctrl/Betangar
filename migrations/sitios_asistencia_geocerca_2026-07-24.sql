-- BETANGAR — geocerca `sitios_asistencia`: la MUEVE administración, no el supervisor
-- Fecha: 2026-07-24
--
-- HUECO (verificado en vivo): `sit_w` era `ALL` a `authenticated` con using(true) →
-- CUALQUIER rol de oficina (operador, rrhh, y hasta demo_admin, que corre en la MISMA
-- base que Betangar real) podía mover o BORRAR las geocercas. Mover una geocerca deja
-- la asistencia de toda una sede fuera de radio. Además la tabla tenía grants completos
-- a `anon` (INSERT/UPDATE/DELETE) — inofensivos hoy porque RLS está ON y no hay policy
-- de escritura para anon, pero se revocan igual (defensa en profundidad: si mañana alguien
-- agrega por error una policy anon permisiva, el grant ya no estará).
--
-- NORMA cross-app: la geocerca la mueve ADMINISTRACIÓN (ver memoria
-- geocerca-la-mueve-administracion; EduControl=edu_is_admin, MaxPersonal=esAdmin).
-- En Betangar administración = superadmin + admin. demo_admin FUERA a propósito.
--
-- CONSUMIDORES VERIFICADOS antes de cerrar (norma: verificar el consumidor):
--   · app.js renderSitios  → SELECT *  (panel de oficina, authenticated)  ......... queda
--   · app.js guardarSitio  → INSERT     (solo superadmin/admin, ahora con guard UI) .. candado
--   · app.js elimSitio     → DELETE     (idem) ...................................... candado
--   · fichar.html:77       → SELECT id,nombre por id  (KIOSCO sin login = anon) ..... queda anon SELECT
--   No hay UPDATE desde la app hoy, pero se crea la policy por si se agrega "editar sitio".

begin;

-- Revocar los grants de ESCRITURA de anon (el kiosco solo lee)
revoke insert, update, delete, truncate, references, trigger
  on public.sitios_asistencia from anon;

-- Reescribir las policies verbo por verbo (nunca `for all`)
drop policy if exists sit_r on public.sitios_asistencia;
drop policy if exists sit_w on public.sitios_asistencia;

-- LEER: kiosco (anon, para fichar.html) + oficina (authenticated)
create policy sit_sel on public.sitios_asistencia
  for select to anon, authenticated
  using ( true );

-- CREAR / MOVER / BORRAR: solo administración (superadmin/admin)
create policy sit_ins on public.sitios_asistencia
  for insert to authenticated
  with check ( app_rol() in ('superadmin','admin') );

create policy sit_upd on public.sitios_asistencia
  for update to authenticated
  using      ( app_rol() in ('superadmin','admin') )
  with check ( app_rol() in ('superadmin','admin') );

create policy sit_del on public.sitios_asistencia
  for delete to authenticated
  using ( app_rol() in ('superadmin','admin') );

commit;
