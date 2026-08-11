-- ════════════════════════════════════════════════════════════════════════════════════════════
-- EL ROL `auditor` PASA A LLAMARSE `revisor`, Y `auditor` NACE DE NUEVO: SOLO LECTURA
-- Máximo, 2026-08-11: «ya tenemos un rol de auditora pero realmente debería tener otro nombre».
--
-- POR QUÉ. El rol que hoy se llama `auditor` NO es un auditor: es `PERMISOS.superadmin.slice()`
-- con el borrado cerrado y autorización obligatoria — el acceso de Alejandra (QA/soporte de
-- Maxware). La auditora DE VERDAD es Arianny Morán (E055 en `empleados`, cargo «Auditora») y lo
-- que pidió es **mirar**, no tocar: mantenimiento por equipo, estados de cuenta y CxP de
-- proveedores, cobro de facturas, RRHH y consumo de combustible por unidad.
--
-- Dos nombres para dos cosas distintas:
--   `revisor`  → lo de antes, intacto. Ve todo, no borra, todo borrado le pide token, 2FA.
--   `auditor`  → nuevo. **No tiene UNA sola política de INSERT, UPDATE ni DELETE.**
--
-- ⛔ POR QUÉ EL RENOMBRE ES SEGURO AUNQUE SE REUSE EL NOMBRE: al renombrar primero, cualquier
-- referencia a 'auditor' que se me haya escapado deja de apuntar a un permiso de escritura —
-- porque las 99 políticas pasan a decir 'revisor'. Si algo quedara suelto, falla CERRADO.
-- Se verifica al final: cero políticas de escritura pueden nombrar a 'auditor'.
--
-- ⚠️ NO SE TOCA NADA DE `edu_*` NI `usdt_*` (Geppetto vive en esta misma base y tiene su PROPIO
-- rol `auditor`, con sus propias funciones `edu_es_auditor`/`edu_is_staff`/`edu_is_admin`).
--
-- Se usa `alter policy` y no `drop/create`: la política nunca deja de existir, y no hay forma de
-- perder por el camino el `to authenticated` ni el `permissive` originales.
--
-- Correr con:  node scripts/correr-sql.mjs hrkjddehqnzcqwlkklqm migrations/rol_revisor_y_auditor_solo_lectura_2026-08-11.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- Deja constancia de lo que hizo cada paso. Una migración que no cambia nada se ve idéntica a una
-- que funcionó — así que cuenta filas y las devuelve al final. (Lección 2026-08-11.)
create temporary table if not exists _mig_log(paso text, detalle text, n int) on commit preserve rows;
truncate _mig_log;

-- ── 1) La persona: Alejandra pasa de `auditor` a `revisor` ───────────────────────────────────
with u as (update public.btg_usuarios set rol='revisor' where rol='auditor' returning 1)
insert into _mig_log select '1. btg_usuarios auditor→revisor', 'usuarios movidos', count(*)::int from u;

-- ── 2) Las 99 políticas: 'auditor' → 'revisor' ───────────────────────────────────────────────
do $mig$
declare r record; nq text; nw text; c int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname='public'
       and (coalesce(qual,'')||coalesce(with_check,'')) like '%''auditor''::text%'
       and tablename not like 'edu\_%' and tablename not like 'usdt\_%'
  loop
    nq := replace(coalesce(r.qual,''),       '''auditor''::text', '''revisor''::text');
    nw := replace(coalesce(r.with_check,''), '''auditor''::text', '''revisor''::text');
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.policyname, r.tablename, nq, nw);
    elsif r.qual is not null then
      execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, nq);
    else
      execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, nw);
    end if;
    c := c + 1;
  end loop;
  insert into _mig_log values ('2. políticas auditor→revisor', 'políticas reescritas', c);
end $mig$;

-- ── 3) Las dos funciones de Betangar que enumeran el rol ─────────────────────────────────────
-- `btg_ve_financiero`: el revisor sigue viéndolo, y la auditora TAMBIÉN (decisión de Máximo,
-- 11/08: «eso + el informe financiero»). No puede auditar lo que no puede ver.
create or replace function public.btg_ve_financiero()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(auth.role() = 'service_role', false)
      or coalesce(public.app_rol() in ('superadmin','visualizador','directivo','revisor','auditor'), false);
$$;

-- `rec_es_staff` (MaxRecuerda): es quién puede CREAR recordatorios. La auditora NO va acá.
create or replace function public.rec_es_staff()
returns boolean language sql stable set search_path to 'public', 'pg_temp' as $$
  select public.app_rol() = any (array['superadmin','admin','operador','rrhh','revisor']);
$$;
insert into _mig_log values ('3. funciones', 'btg_ve_financiero + rec_es_staff', 2);

-- ── 4) El rol `auditor` nuevo: SELECT y nada más ─────────────────────────────────────────────
-- Se agrega SOLO a políticas de SELECT, y solo en las tablas de los módulos que se le habilitan.
-- Quedan FUERA a propósito: `caja_chica` y `caja_chica_reposiciones` (no está en su menú) y
-- `configuracion` (guarda secretos: token de Wassenger, llave de Gemini — su SELECT lo filtra
-- `cfg_sel` y no se toca).
do $mig$
declare r record; c int := 0;
  tablas text[] := array[
    -- cobro de facturas / abonos
    'abonos','cobros_factura','pagos_alcaldia','contratos',
    -- estados de cuenta (banco BNC) y conciliación
    'bnc_movimientos','bnc_entidades','bnc_entidad_ident','bnc_cuentas_propias',
    'bnc_notificaciones','bnc_sync_log','pagos_bnc','btg_fondo_divisas',
    -- CxP de proveedores
    'proveedores','cxp','cxp_facturas','cxp_pagos',
    -- RRHH
    'empleados','nomina_historial','pagos_nomina','prestamos','multas','anomalias_rrhh',
    -- mantenimiento por equipo
    'ordenes_servicio','piezas',
    -- combustible por unidad
    'surtidas','combustible_periodos',
    -- informe financiero / relación de gastos
    'gastos_fijos','gastos_variables',
    -- Carpeta del Auditor: la sección «accesos y roles» sale de acá
    'btg_usuarios'
  ];
begin
  for r in
    select p.tablename, p.policyname, p.qual
      from pg_policies p
     where p.schemaname='public' and p.cmd='SELECT'
       and p.tablename = any(tablas)
       and coalesce(p.qual,'') like '%''revisor''::text%'
       and coalesce(p.qual,'') not like '%''auditor''::text%'   -- correr dos veces no duplica
  loop
    execute format('alter policy %I on public.%I using (%s)',
      r.policyname, r.tablename,
      replace(r.qual, '''revisor''::text', '''revisor''::text, ''auditor''::text'));
    c := c + 1;
  end loop;
  insert into _mig_log values ('4. SELECT para auditor', 'políticas de lectura abiertas', c);
  if c <> array_length(tablas,1) then
    insert into _mig_log values ('4. ⚠️ AVISO', 'se esperaban '||array_length(tablas,1)||' tablas y se tocaron '||c||' — revisar cuáles quedaron fuera', 0);
  end if;
end $mig$;

-- ── 5) VERIFICACIÓN: que `auditor` no pueda escribir en NINGUNA parte ────────────────────────
insert into _mig_log
select '5. ⛔ CONTROL: escritura de auditor', 'políticas INSERT/UPDATE/DELETE que nombran a auditor (debe ser 0)', count(*)::int
  from pg_policies
 where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
   and (coalesce(qual,'')||coalesce(with_check,'')) like '%''auditor''::text%'
   and tablename not like 'edu\_%' and tablename not like 'usdt\_%';

insert into _mig_log
select '5. control: lectura de auditor', 'políticas SELECT que nombran a auditor', count(*)::int
  from pg_policies
 where schemaname='public' and cmd='SELECT'
   and coalesce(qual,'') like '%''auditor''::text%'
   and tablename not like 'edu\_%' and tablename not like 'usdt\_%';

insert into _mig_log
select '5. control: revisor conserva lo suyo', 'políticas que nombran a revisor (esperado 99)', count(*)::int
  from pg_policies
 where schemaname='public'
   and (coalesce(qual,'')||coalesce(with_check,'')) like '%''revisor''::text%';

insert into _mig_log
select '5. control: Geppetto intacto', 'políticas edu_* que nombran a auditor (no se tocaron)', count(*)::int
  from pg_policies
 where schemaname='public' and tablename like 'edu\_%'
   and (coalesce(qual,'')||coalesce(with_check,'')) like '%''auditor''::text%';

select * from _mig_log;
