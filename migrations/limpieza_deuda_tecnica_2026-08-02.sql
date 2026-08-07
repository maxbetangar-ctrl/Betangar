-- ============================================================================
-- LIMPIEZA DE DEUDA TÉCNICA — auditoría multi-tenant 2026-08-02
-- ============================================================================
-- Este archivo tiene TRES bloques. Cada uno va a una base distinta.
-- Respaldo previo en:  C:\Users\Maxbetangar\backups_limpieza_2026-08-02
--
-- ⚠️ NO es idempotente en el sentido de "reversible": los DROP borran de verdad.
--    El respaldo es la vuelta atrás.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE A — Maxware-Principal  [hrkjddehqnzcqwlkklqm]
-- ════════════════════════════════════════════════════════════════════════════
--
-- A.1 · Prototipo MaxCrypto abandonado.
--   MaxCrypto vive en su propia base (dvtqlkueptmjiyiiljlv): 383 transferencias,
--   516 notificaciones, datos reales. Lo que quedó aquí es el prototipo:
--   10 filas en total entre 9 tablas y CERO actividad.
--   Además `usdt_usuarios_rol` tiene una política que se consulta a sí misma
--   (`admin_gestiona_roles` → EXISTS SELECT FROM usdt_usuarios_rol) → error
--   42P17 "infinite recursion" en cualquier consulta de un usuario logueado.
--   No se parchea la política de un muerto: se entierra.

drop view if exists public.usdt_libro_mayor            cascade;
drop view if exists public.usdt_resumen_bancos         cascade;
drop view if exists public.usdt_resumen_pagos_contacto cascade;
drop view if exists public.usdt_vista_visor            cascade;

drop table if exists public.usdt_verificaciones_log cascade;
drop table if exists public.usdt_transferencias     cascade;
drop table if exists public.usdt_mis_wallets        cascade;
drop table if exists public.usdt_usuarios_rol       cascade;
drop table if exists public.usdt_contactos          cascade;
drop table if exists public.usdt_bancos             cascade;
drop table if exists public.usdt_config             cascade;
drop table if exists public.usdt_pagos              cascade;
drop table if exists public.usdt_usos               cascade;

drop function if exists public.usdt_es_admin()      cascade;
drop function if exists public.usdt_resumen_visor() cascade;
drop function if exists public.usdt_saldo_actual()  cascade;
drop function if exists public.verificar_txid(p_txid text, p_red text) cascade;

-- A.2 · Respaldos duplicados sin lectores.
--   zzz_flota_estado_bak: la marcaste "RETIRADA 2026-07-21" en su propio comentario.
drop table if exists public.zzz_flota_estado_bak           cascade;
drop table if exists public.combustible_mediciones_dup_bkp cascade;

-- A.3 · Usuarios de prueba que NUNCA se loguearon.
--   NO se tocan `demo@maxpersonal.app` (login 2026-07-20) ni
--   `maxbetangar+demo@gmail.com` (login 2026-07-27): están VIVOS, son las demos
--   comerciales. Tampoco `maxbetangar+demo-personal@gmail.com` (creado 2026-07-26,
--   sin usar todavía) — es tuyo y puede ser una demo por estrenar.
delete from auth.users
where email in ('demo_rrhh@betangar.local',
                'demo_admin@betangar.local',
                'demo_operador@betangar.local',
                'pruebacop@test.local',
                'pruebaparcial@test.local')
  and last_sign_in_at is null;   -- candado: si alguno se usó, no se borra


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE B — FLOTILLA  [mcvizzknpqrggohbohcw]
-- ════════════════════════════════════════════════════════════════════════════
--
-- B.1 · backup_restore (2.966 filas / 6,3 MB) — la tabla más pesada de la base.
--   Sin lectores en la BD y sin una sola referencia en el código de las apps.
--   Y NO es basura inocente: 660 de sus filas son de tablas AJENAS —
--   edu_alumnos, edu_representantes, edu_usuarios, edu_pin_semanal, edu_pagos,
--   edu_cuentas_bancarias, bnc_config, bnc_movimientos… Es decir, PII de niños y
--   familias de Geppetto + configuración bancaria, arrastradas al clonar Principal
--   para armar la base del cliente de transporte.
--   El original vive en Principal (org PRO, backups diarios). Aquí sobra y no
--   debería haber llegado nunca.
drop table if exists public.backup_restore       cascade;
drop table if exists public.zzz_flota_estado_bak cascade;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE C — FLOTILLA + VIDECA + FlotaMax-DEMO
--   [mcvizzknpqrggohbohcw] [mmofoizzzpcnqhmzkevm] [mogntbltkkdtyojrchvh]
-- ════════════════════════════════════════════════════════════════════════════
--
-- Funciones de COLEGIO heredadas al clonar. En estas bases hay CERO tablas edu_*
-- y CERO triggers que las llamen: apuntan a edu_usuarios / edu_representantes /
-- edu_alumnos, que no existen. Fallarían con "relation does not exist".
-- Son superficie de ataque y ruido que confunde cualquier auditoría futura.
drop function if exists public.edu_get_pin_semanal(p_tenant_id uuid) cascade;
drop function if exists public.edu_get_tenant_id()                   cascade;
drop function if exists public.edu_tenant_de_auth()                  cascade;
drop function if exists public.edu_is_staff()                        cascade;
drop function if exists public.edu_mis_alumnos()                     cascade;
drop function if exists public.edu_handle_new_auth_user()            cascade;
drop function if exists public.edu_on_auth_user_created()            cascade;
drop function if exists public.edu_renovar_token(p_solicitud_id uuid) cascade;
