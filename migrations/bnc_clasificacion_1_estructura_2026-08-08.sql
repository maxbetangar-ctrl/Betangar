-- ============================================================================
-- Betangar · clasificación de los movimientos del banco EN LA BASE
-- 2026-08-08. Máximo: «pero debería clasificar todo en sql, no?»
--
-- Hasta hoy la clasificación se re-deducía en cada análisis desde el texto del
-- concepto, y por eso dos corridas podían dar distinto. A partir de acá la
-- categoría es un DATO guardado, con constancia de QUIÉN la decidió.
--
-- Tres capas, en este orden (lo de arriba gana):
--   1. manual      -> lo dictó Máximo para ESE movimiento
--   2. concepto    -> regla de texto DENTRO de la entidad (Auto Unión recibe
--                     compra de dólares Y pagos por reparación: la entidad sola
--                     no alcanza para decidir)
--   3. entidad     -> categoría por defecto (Found Petrol -> divisas, siempre)
-- ============================================================================

-- ---------------------------------------------------------------- entidades
-- No se tocó `proveedores`: ahí van proveedores de verdad y alimenta otras
-- pantallas. Los socios y casas de cambio no son proveedores. Para no duplicar
-- el diccionario, esta tabla APUNTA a `proveedores` cuando la entidad ya existe.
create table if not exists bnc_entidades (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  proveedor_id  text references proveedores(id) on delete set null,  -- proveedores.id es TEXT
  categoria     text not null default 'sin_clasificar',
  es_gasto      boolean not null default true,
  nota          text,
  created_at    timestamptz not null default now()
);
comment on table bnc_entidades is
  'Quién es quién en el estado de cuenta. categoria = por defecto; el concepto puede afinarla.';
comment on column bnc_entidades.es_gasto is
  'false = sale plata pero NO es gasto del período: compra de divisas, préstamo a empleado.';

-- ------------------------------------------------------- sus identificadores
-- Una entidad puede tener VARIAS cuentas y varios documentos. Auto Unión cobra
-- por dos cuentas distintas, y `proveedores` guardaba una sola: por eso se veían
-- 20 movimientos por Bs 8,8M en vez de 26 por Bs 20,7M, y la compra de dólares
-- quedaba invisible. El identificador se guarda NORMALIZADO (sin guiones ni
-- espacios), porque el banco escribe J501030235 y el maestro J-50103023-5.
create table if not exists bnc_entidad_ident (
  id          uuid primary key default gen_random_uuid(),
  entidad_id  uuid not null references bnc_entidades(id) on delete cascade,
  tipo        text not null,               -- 'rif' | 'cedula' | 'cuenta'
  ident       text not null,               -- YA normalizado
  created_at  timestamptz not null default now(),
  unique (tipo, ident)
);
create index if not exists ix_bnc_ident_entidad on bnc_entidad_ident(entidad_id);

-- --------------------------------------- la clasificación, en el movimiento
alter table bnc_movimientos
  add column if not exists entidad_id      uuid references bnc_entidades(id) on delete set null,
  add column if not exists categoria       text,
  add column if not exists es_gasto        boolean,
  add column if not exists clasificado_por text,      -- 'entidad' | 'concepto' | 'manual:<quien>'
  add column if not exists clasificado_at  timestamptz;

comment on column bnc_movimientos.clasificado_por is
  'De dónde salió la categoría. Lo que empieza por manual: lo decidió una persona y NO se pisa solo.';

create index if not exists ix_bnc_mov_entidad   on bnc_movimientos(entidad_id);
create index if not exists ix_bnc_mov_categoria on bnc_movimientos(categoria);

-- ------------------------------------------------------------- normalizador
-- Fuente única: el mismo criterio para el maestro y para el texto del banco.
-- Sin esto el cruce da CERO y parece que no hay coincidencias.
create or replace function bnc_norm_ident(t text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(t,''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- --------------------------------------------------------------- seguridad
-- Mismo patrón que `bnc_movimientos` y `proveedores`: RLS ON, verbo por verbo,
-- solo `authenticated`, y anon SIN NADA. [[norma-tabla-nueva-revocar-anon]]
alter table bnc_entidades      enable row level security;
alter table bnc_entidad_ident  enable row level security;

revoke all on bnc_entidades     from anon, public;
revoke all on bnc_entidad_ident from anon, public;
grant select, insert, update, delete on bnc_entidades     to authenticated;
grant select, insert, update, delete on bnc_entidad_ident to authenticated;

do $$
declare t text;
begin
  foreach t in array array['bnc_entidades','bnc_entidad_ident'] loop
    execute format('drop policy if exists btg_rol_lectura on %I', t);
    execute format('drop policy if exists btg_rol_ins on %I', t);
    execute format('drop policy if exists btg_rol_upd on %I', t);
    execute format('drop policy if exists btg_rol_del on %I', t);

    execute format($f$create policy btg_rol_lectura on %I for select to authenticated
      using (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh']))$f$, t);

    execute format($f$create policy btg_rol_ins on %I for insert to authenticated
      with check (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))$f$, t);

    execute format($f$create policy btg_rol_upd on %I for update to authenticated
      using (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
      with check (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))$f$, t);

    execute format($f$create policy btg_rol_del on %I for delete to authenticated
      using (app_rol() = any (array['superadmin','admin']) and not app_exige_token())$f$, t);
  end loop;
end $$;
