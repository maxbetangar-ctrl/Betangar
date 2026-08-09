-- ============================================================================
-- Betangar · QUÉ FACTURA SE COBRÓ DE VERDAD
-- 2026-08-09.
--
-- La Alcaldía paga cada factura en DOS PATAS: el NETO (≈90,9% de la base, ya
-- descontadas retenciones) y el 10% de FIEL CUMPLIMIENTO días después. Hasta
-- hoy el sistema sabía qué facturas EMITIÓ pero no cuáles COBRÓ: los 33 créditos
-- del banco eran un montón de plata sin dueño.
--
-- El cruce se hizo con la MISMA fórmula que usa la app (`calcRetenciones` de
-- money.js), no con una copia. Resultado: 33 de 33 cobros identificados.
--
-- ⚠️ DOS COSAS QUE SE APRENDIERON CRUZANDO, Y QUE HAY QUE RESPETAR:
--
--  1. EL COBRO PUEDE LLEGAR ANTES QUE LA FECHA DE LA FACTURA. El neto de la
--     000632 entró el 19/06 y la factura está fechada el 20/06. Exigir que el
--     cobro fuera posterior dejaba US$ 19.586,99 sin dueño.
--
--  2. EL MONTO SOLO NO ALCANZA PARA EMPAREJAR. Las patas del 10% rondan TODAS
--     US$ 1.700 porque muchas facturas son de 54 viajes. Emparejando por "menor
--     diferencia" un cobro casó con una factura de 95 DÍAS ANTES en vez de con
--     la de 4 días. Hay que puntuar monto Y cercanía. Los 33 pares buenos caen
--     todos entre 0 y 6 días de su factura: ESE es el patrón.
--     [[norma-lo-ambiguo-se-mide-entre-candidatos]]
-- ============================================================================

alter table bnc_movimientos add column if not exists factura text;
alter table bnc_movimientos add column if not exists pata    text;   -- 'neto' | 'fiel'

comment on column bnc_movimientos.factura is
  'Qué factura cobra este crédito. NULL = no se pudo determinar, y eso es una respuesta legítima.';
comment on column bnc_movimientos.pata is
  'neto = el ≈90,9% que entra con la factura · fiel = el 10% de fiel cumplimiento, días después.';

create index if not exists ix_bnc_mov_factura on bnc_movimientos (factura);

-- ---------------------------------------------------------------------------
-- Estado de cobro por factura. Se calcula, no se teclea: si mañana entra el
-- fiel que falta, el cuadro cambia solo.
-- ---------------------------------------------------------------------------
create or replace view v_cobro_facturas
with (security_invoker = true) as      -- [[vista-sin-security-invoker-fail-open]]
select
  a.fact                                                        as factura,
  a.f                                                           as fecha,
  a.v                                                           as viajes,
  a.m                                                           as base_usd,
  round((a.m * 0.909)::numeric, 2)                              as neto_esperado_usd,
  round((a.m * 0.10)::numeric, 2)                               as fiel_esperado_usd,
  (select count(*) from bnc_movimientos m where m.factura = a.fact and m.pata = 'neto') > 0 as neto_cobrado,
  (select count(*) from bnc_movimientos m where m.factura = a.fact and m.pata = 'fiel') > 0 as fiel_cobrado,
  (select coalesce(sum(m.monto),0) from bnc_movimientos m where m.factura = a.fact)         as cobrado_bs,
  (select min(m.fecha) from bnc_movimientos m where m.factura = a.fact and m.pata = 'neto') as fecha_neto,
  (select min(m.fecha) from bnc_movimientos m where m.factura = a.fact and m.pata = 'fiel') as fecha_fiel
from abonos a;

comment on view v_cobro_facturas is
  'Qué se facturó y qué se cobró de verdad, factura por factura. fiel_cobrado=false en una factura vieja es plata que la Alcaldía debe.';

revoke all on v_cobro_facturas from anon, public;
grant select on v_cobro_facturas to authenticated;
