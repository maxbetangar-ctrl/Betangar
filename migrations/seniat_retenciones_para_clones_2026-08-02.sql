-- ════════════════════════════════════════════════════════════════════════════
-- LA CUENTA DEL SENIAT — retenciones acumuladas por quincena   (2026-08-02)
--
-- Máximo: «eso lo deben tener TODAS, con un interruptor de si eres agente de retención o no,
--          aunque casi el 90% de las empresas hoy son agentes de retención».
--
-- POR QUÉ EXISTE: cuando se le compra a un proveedor no se le paga la factura completa — se le
-- retiene parte del IVA (75% ordinario / 100% especial) y a veces el ISLR. Esa plata NO es de la
-- empresa: se le debe al SENIAT y hay que enterarla en la fecha del calendario. Sin esta tabla
-- ese dinero solo existía dentro del libro de compras en bolívares: no aparecía como deuda, ni
-- en vencimientos, ni en el flujo de caja. Se veía saldo en el banco que en realidad no era propio.
--
-- ⚠️ VA EN BOLÍVARES, A PROPÓSITO. Todo el resto del módulo está en dólares, pero al SENIAT se le
-- deben Bs EXACTOS: si la obligación viviera en $, al moverse la tasa cambiaría sola, y eso es
-- falso. Por eso vive acá y NO en `cxp` (esa tabla es toda en $ y es de PROVEEDORES).
--
-- ⚠️ ES UNA SOLA CUENTA POR QUINCENA (1–15 y 16–fin de mes), no una por factura: cada factura
-- suma a la suya. `periodo` es UNIQUE para que el upsert acumule en vez de duplicar, y para que
-- al borrar una factura el acumulado baje solo (idempotente).
--
-- ⚠️ EL IVA RETENIDO NO ES UN GASTO EXTRA: ya entró como costo al cargar la factura. Esta cuenta
-- es de TESORERÍA (a quién se le paga), por eso se excluye de los egresos de la Utilidad Real.
--
-- Migración PURAMENTE ADITIVA. Correr en la base de cada cliente (Flotilla, VIDECA, demo).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.seniat_retenciones (
  id             bigint generated always as identity primary key,
  periodo        text not null unique,          -- '2026-07-Q1' | '2026-07-Q2'
  etiqueta       text,                          -- '1ra quincena julio 2026'
  desde          date, hasta date,
  ret_iva_bs     numeric default 0,
  ret_islr_bs    numeric default 0,
  total_bs       numeric default 0,
  facturas       integer default 0,
  usd_referencia numeric default 0,             -- SOLO referencia, cada factura a su tasa
  estado         text default 'pendiente',      -- pendiente | declarada | pagada
  fecha_declarada date, fecha_pago date, ref_pago text,
  nota           text default '',
  updated_at     timestamptz default now()
);

-- Fechas límite de declaración por período. La tarjeta las muestra si están cargadas; si la
-- tabla está vacía no se rompe nada (la consulta va dentro de un try).
create table if not exists public.calendario_fiscal (
  id            bigint generated always as identity primary key,
  obligacion    text,                           -- 'IVA quincenal', 'ISLR', ...
  etiqueta      text,
  periodo       text,
  fecha_declarar date,
  declarado     boolean default false,
  fecha_declarada date,
  monto_declarado_bs numeric,
  nota          text default '',
  created_at    timestamptz default now()
);

create index if not exists idx_seniat_estado on public.seniat_retenciones(estado);
create index if not exists idx_calfis_periodo on public.calendario_fiscal(periodo);

-- ── RLS (norma: tabla nueva = revocar anon + política VERBO POR VERBO) ───────
do $$
declare t text;
begin
  foreach t in array array['seniat_retenciones','calendario_fiscal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant all on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t||'_upd', t);
    -- Borrar mueve una obligación fiscal: mismo candado que el resto.
    execute format('create policy %I on public.%I for delete to authenticated using (app_rol() = ''superadmin'')', t||'_del', t);
  end loop;
end $$;

-- ── Comprobación (correr después) ───────────────────────────────────────────
--   select periodo, etiqueta, total_bs, estado from public.seniat_retenciones order by periodo;
--   -- Debe empezar vacía: se llena sola al cargar la primera factura con retención.
