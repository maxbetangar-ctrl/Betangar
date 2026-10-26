-- ═══════════════════════════════════════════════════════════════════════════════
-- DESCUENTO POR PRONTO PAGO — 2026-10-26
--
-- 🔴 EL PROBLEMA. La tarifa del viaje era UN número en el localStorage de CADA navegador
--    (`cfg.tarifa`). Sin fecha, sin historial y sin compartirse. El valor que queda grabado
--    en una planilla depende de QUIÉN la cargó y de qué tenía su navegador ese día.
--    Medido el 26/10/2026 sobre las 2.173 planillas:
--      · 12 al 18/10 → 174 viajes a $261,20 y 20 a $316,88 (SEIS días con las dos a la vez)
--      · 19 al 22/10 → 129 viajes a $316,88, o sea VOLVIÓ a la tarifa vieja
--      · 23 al 25/10 → 62 viajes a $261,20
--    No era una regla: era quién cargaba.
--
-- 🔎 Y DE AHÍ SALIÓ EL 261,20 DEL ABONO 000651. `calcMontoAbono()` hace
--    `monto = viajes × cfg.tarifa`. Quien registró ese pago tenía 261,20 en su navegador, así
--    que tecleó 165 viajes y el monto salió 43.098 solo. El descuento entró por la puerta de
--    la configuración, no por una decisión registrada en ninguna parte.
--
-- ✅ LA REGLA REAL, declarada por Máximo el 26/10/2026:
--    «negocié con la Alcaldía que si me hace un buen abono le doy el descuento, sobre los
--     viajes ejecutados la semana anterior al pago. De no hacerlo esos viajes quedan al
--     precio de 39 y pico.»
--    «todo sigue siendo a 39 sin complicación y solo al momento del pago hago un descuento
--     por pronto pago o abono grande.»
--
--    ⇒ El descuento NO es una tarifa que cambia en una fecha: es una CONCESIÓN que se otorga
--      pago por pago, y es condicional. Por eso el viaje vale SIEMPRE la tarifa de contrato
--      ($39,61/t × 8 t = $316,88) y lo que lleva la marca es EL ABONO.
--    [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Las tarifas salen del navegador y pasan a `configuracion` (compartidas por todos).
--   2. `abonos.descuento`: la marca de «este pago se premió con el descuento».
--   3. Respalda y corrige las 93 planillas que quedaron valoradas a $261,20.
--   4. Marca el abono 000651, que es el único con el descuento ya aplicado.
--
-- ⛔ REVERSIBLE: antes de tocar `planillas` se guarda cada fila afectada en
--    `configuracion` bajo la clave `backup_planillas_tarifa_2026-10-26` (la misma convención
--    de `backup_cobros_factura_2026-08-10`). Al final de este archivo está el UNDO.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Las tarifas, en la base y no en el navegador ─────────────────────────────
-- Se guardan POR TONELADA porque así se negocia el contrato; el viaje son 8 t.
insert into public.configuracion (clave, valor) values
  ('tarifa_contrato_ton',     '39.61'),
  ('tarifa_pronto_pago_ton',  '32.65'),
  ('tarifa_toneladas_viaje',  '8')
on conflict (clave) do update set valor = excluded.valor, updated_at = now();

-- ── 2) La marca del descuento, en el ABONO ──────────────────────────────────────
alter table public.abonos
  add column if not exists descuento boolean not null default false;

comment on column public.abonos.descuento is
  'true = a este pago se le otorgo el descuento por pronto pago (USD 32,65/t en vez de 39,61/t). La decision es por PAGO y es condicional: si no se otorga, esos viajes quedan a la tarifa de contrato. Ver migrations/descuento_pronto_pago_2026-10-26.sql';

-- ── 3) Respaldo ANTES de tocar nada ─────────────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_planillas_tarifa_2026-10-26',
       coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'p', p.p, 'f', p.f, 't', p.t, 'm', p.m) order by p.id)::text, '[]')
  from public.planillas p
 where p.t > 0 and round(p.m / p.t, 2) = 261.20
on conflict (clave) do nothing;   -- si ya existe, NO se pisa: el respaldo original manda

-- ── 4) Las planillas vuelven a la tarifa de CONTRATO ────────────────────────────
-- Todo viaje vale $316,88. El descuento no es una propiedad del viaje.
update public.planillas p
   set m = round(p.t * 316.88, 2)
 where p.t > 0 and round(p.m / p.t, 2) = 261.20;

-- ── 5) El único abono que SÍ llevó el descuento ─────────────────────────────────
-- Se identifica por la aritmética (monto/viajes = 261,20), no por el número de factura:
-- si hubiera otro igual, también le corresponde la marca.
update public.abonos
   set descuento = true
 where v > 0 and abs(m / v - 261.20) < 0.5;

-- ── CONTROLES: si algo de esto falla, la migración se cae y no deja nada a medias ──
do $$
declare n_plan int; n_ab int; n_cfg int;
begin
  -- a) Ninguna planilla puede seguir valorada al precio con descuento.
  select count(*) into n_plan from public.planillas where t > 0 and round(m / t, 2) = 261.20;
  if n_plan > 0 then
    raise exception 'Quedaron % planillas a 261,20: la correccion no se aplico entera', n_plan;
  end if;

  -- b) CONTROL POSITIVO: tiene que haber quedado marcado al menos un abono con descuento.
  --    Sin esto, una migracion que no marco NADA se ve igual que una que funciono.
  select count(*) into n_ab from public.abonos where descuento;
  if n_ab < 1 then
    raise exception 'Ningun abono quedo marcado con descuento: se esperaba al menos el 000651';
  end if;

  -- c) Las tres claves de tarifa tienen que existir.
  select count(*) into n_cfg from public.configuracion
   where clave in ('tarifa_contrato_ton','tarifa_pronto_pago_ton','tarifa_toneladas_viaje');
  if n_cfg <> 3 then
    raise exception 'Faltan claves de tarifa en configuracion (hay %, se esperaban 3)', n_cfg;
  end if;

  -- d) El respaldo tiene que existir y no estar vacio.
  if not exists (select 1 from public.configuracion
                  where clave = 'backup_planillas_tarifa_2026-10-26' and valor <> '[]' and valor is not null) then
    raise exception 'El respaldo de planillas no se escribio: no se puede deshacer, se aborta';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO (pegar a mano si hay que volver atras):
--
--   update public.planillas p
--      set m = (b.v->>'m')::numeric
--     from (select jsonb_array_elements(valor::jsonb) v
--             from public.configuracion
--            where clave = 'backup_planillas_tarifa_2026-10-26') b
--    where p.id = (b.v->>'id')::bigint;
--
--   update public.abonos set descuento = false;
--   -- y, si se quiere, borrar las 3 claves de tarifa de `configuracion`.
-- ═══════════════════════════════════════════════════════════════════════════════
