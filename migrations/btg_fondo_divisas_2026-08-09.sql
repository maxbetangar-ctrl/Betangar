-- ============================================================================
-- Betangar · EL LIBRO DEL FONDO EN DÓLARES — entra, sale, y cuánto queda
-- 2026-08-09.
--
-- Máximo: «que tenga la información inicial que ya te di y continúe avanzando
-- con las próximas compras, que tenga cómo registrar un gasto de esos dólares,
-- sea para pagar la amortización de los camiones o que se tengan que vender
-- para algo».
--
-- QUÉ RESUELVE
-- Hasta hoy los dólares comprados se sabían (están en el banco, en bolívares)
-- pero lo que se HACÍA con ellos vivía en una app en el teléfono de Máximo. El
-- sistema podía decir «se compraron X» y no «quedan Y», que es lo que un socio
-- pregunta.
--
-- ⛔ POR QUÉ EL SALDO NO SE PUEDE DEDUCIR DEL BANCO
-- Los dólares los compra Auto Unión: se le pasan bolívares y ella los aplica a
-- la deuda de los camiones. Por eso el banco dice «PAGO PARA CAMBIO DE MONEDA»
-- y **no existe ningún movimiento que diga "pago del crédito"** — son el mismo
-- hecho. Buscar los pagos de la deuda por separado da CERO. La aplicación a la
-- deuda hay que registrarla acá.
--
-- LA APERTURA (lo que ya estaba y no salía de ningún sistema):
--   +  6.000  con que abre el fondo, anterior al 23/03
--   + 71.119  comprado dentro del estado de cuenta (16 operaciones)
--   −  2.356  vendidos para cubrir nómina
--   = 74.763  comprados en total  ← el número que Máximo lleva contado
--   − 48.318  aplicados a la deuda de los camiones
--   = 26.445  que quedan en la cuenta de Alejandro Castillo
-- ============================================================================

create table if not exists btg_fondo_divisas (
  id           bigserial primary key,
  fecha        date    not null,
  tipo         text    not null check (tipo in ('apertura','compra','aplicacion_deuda','venta','ajuste')),
  usd          numeric not null,          -- POSITIVO entra al fondo, NEGATIVO sale
  bs           numeric,                   -- los bolívares que se movieron (si aplica)
  tasa         numeric,                   -- la tasa PACTADA, no la del BCV
  concepto     text    not null,
  mov_id       text references bnc_movimientos(id) on delete set null,  -- el movimiento del banco
  registrado_por text not null default 'sistema',
  created_at   timestamptz not null default now()
);

comment on table btg_fondo_divisas is
  'Libro del fondo en dólares: lo que entra (compras) y lo que sale (aplicado a la deuda de los camiones, vendido para nómina). El saldo NO se puede deducir del banco porque comprar los dólares y abonar la deuda son el mismo movimiento.';
comment on column btg_fondo_divisas.usd is
  'Positivo = entra al fondo. Negativo = sale. El saldo es la suma.';
comment on column btg_fondo_divisas.tasa is
  'La tasa PACTADA de la operación. Nunca la del BCV: la compra de dólares es lo único que siempre tiene una tasa distinta a todas las que maneja el sistema.';

create index if not exists ix_fondo_fecha on btg_fondo_divisas (fecha);

-- ── LA APERTURA Y LO YA CONOCIDO ────────────────────────────────────────────
insert into btg_fondo_divisas (fecha, tipo, usd, bs, tasa, concepto, registrado_por)
select * from (values
  ('2026-03-22'::date, 'apertura', 6000::numeric, null::numeric, null::numeric,
   'Saldo con que abre el fondo — dólares anteriores al estado de cuenta (23/03)', 'Máximo'),
  ('2026-07-30'::date, 'venta', -2356::numeric, null::numeric, null::numeric,
   'Vendidos para cubrir nómina', 'Máximo'),
  -- ⛔ LA APLICACIÓN A LA DEUDA SON 48.318, NO 33.718. Se probó registrando solo los 33.718 y el
  -- fondo quedó en US$ 41.045 cuando Máximo tiene contados 26.445: sobraban exactamente 14.600.
  -- Ese es el monto de las compras hechas A AUTO UNIÓN (7.600 + 1.500 + 500 + 3.000 + 2.000).
  -- Esas compras ENTRAN al fondo y SALEN en el mismo acto hacia la deuda: se le pasan bolívares,
  -- ella compra los dólares y los aplica al crédito. Contarlas como entrada sin su salida
  -- infla el fondo. Por eso van en dos filas, para que el paso se vea.
  ('2026-07-23'::date, 'aplicacion_deuda', -33718::numeric, null::numeric, null::numeric,
   'Aplicado a la deuda de los camiones DESDE EL FONDO (parte de los 6 pagos del 15/06 al 23/07)', 'Máximo + Excel de amortización'),
  ('2026-07-23'::date, 'aplicacion_deuda', -14600::numeric, null::numeric, null::numeric,
   'Aplicado a la deuda directamente por Auto Unión: son las compras que se le hicieron a ella (7.600+1.500+500+3.000+2.000). Entran al fondo y salen en el mismo acto — no se quedan.', 'Máximo + Excel de amortización')
) as v(fecha,tipo,usd,bs,tasa,concepto,registrado_por)
where not exists (select 1 from btg_fondo_divisas where tipo in ('apertura','venta','aplicacion_deuda'));

-- Las COMPRAS salen del banco, no se teclean: una fila por cada movimiento
-- `compra_divisas` que ya tenga su tasa. Idempotente por `mov_id`.
insert into btg_fondo_divisas (fecha, tipo, usd, bs, tasa, concepto, mov_id, registrado_por)
select m.fecha::date, 'compra',
       round((m.monto / m.tasa_real)::numeric, 2), m.monto, m.tasa_real,
       'Compra de dólares — ' || left(regexp_replace(coalesce(m.concepto_banco, m.descripcion,''), '\s+', ' ', 'g'), 60),
       m.id, 'banco'
  from bnc_movimientos m
 where m.categoria = 'compra_divisas' and m.tasa_real > 0
   and not exists (select 1 from btg_fondo_divisas f where f.mov_id = m.id);

alter table btg_fondo_divisas enable row level security;
revoke all on btg_fondo_divisas from anon, public;
grant select, insert, update, delete on btg_fondo_divisas to authenticated;
do $$
begin
  drop policy if exists btg_rol_lectura on btg_fondo_divisas;
  drop policy if exists btg_rol_ins on btg_fondo_divisas;
  drop policy if exists btg_rol_upd on btg_fondo_divisas;
  drop policy if exists btg_rol_del on btg_fondo_divisas;
  create policy btg_rol_lectura on btg_fondo_divisas for select to authenticated
    using (app_rol() = any (array['superadmin','auditor','admin','operador','visualizador','directivo','demo_admin','demo_operador']));
  create policy btg_rol_ins on btg_fondo_divisas for insert to authenticated
    with check (app_rol() = any (array['superadmin','admin','auditor']));
  create policy btg_rol_upd on btg_fondo_divisas for update to authenticated
    using (app_rol() = any (array['superadmin','admin','auditor']))
    with check (app_rol() = any (array['superadmin','admin','auditor']));
  create policy btg_rol_del on btg_fondo_divisas for delete to authenticated
    using (app_rol() = any (array['superadmin','admin']) and not app_exige_token());
end $$;

-- ── EL ESTADO DEL FONDO ─────────────────────────────────────────────────────
create or replace view v_fondo_divisas
with (security_invoker = true) as
select
  coalesce(sum(usd) filter (where tipo in ('apertura','compra')), 0)          as entrado_usd,
  coalesce(sum(usd) filter (where tipo = 'compra'), 0)                        as comprado_usd,
  coalesce(-sum(usd) filter (where tipo = 'aplicacion_deuda'), 0)             as a_deuda_usd,
  coalesce(-sum(usd) filter (where tipo = 'venta'), 0)                        as vendido_usd,
  coalesce(sum(usd), 0)                                                       as saldo_usd,
  coalesce(sum(bs) filter (where tipo='compra'), 0)                           as bs_invertidos,
  count(*) filter (where tipo='compra')                                       as compras
from btg_fondo_divisas;

comment on view v_fondo_divisas is
  'Cuánto se compró, cuánto se aplicó a la deuda, cuánto se vendió y cuánto QUEDA. El saldo es lo que un socio pregunta.';

revoke all on v_fondo_divisas from anon, public;
grant select on v_fondo_divisas to authenticated;
