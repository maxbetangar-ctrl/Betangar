-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Reemplazar las 5 filas ESTIMADAS de la Alcaldía por los depósitos REALES del banco.
--
-- Qué había: al registrar cada abono, la app creaba UNA fila en `bnc_movimientos` con el total
-- esperado de la factura, convertido a bolívares. Eso no es lo que pasó en la cuenta:
--
--   · La Alcaldía deposita en DOS partes: ≈90% primero y el 10% de FIEL CUMPLIMIENTO días después.
--     Comprobado contra el estado de cuenta: la 000634 esperaba Bs 993.187,00 de fiel y el banco
--     recibió Bs 993.187,00 el 09/07 — exacto al céntimo. Las otras cuatro difieren 0,13%–1,70%,
--     que es la tasa del día del depósito.
--   · Y dos de las cinco se convirtieron con la tasa de OTRO DÍA: la 000634 (del 03/07) a 674,9305,
--     que es la del 6 de julio; la 000635 (del 10/07) a 709,6935, la del 12. Causa ya corregida en
--     `app.js` (commit 8e1ad3f): usaba la tasa de HOY en vez de la del día de la factura.
--
-- ⛔ NO SE BORRA A SECAS. Las filas se ARCHIVAN primero, con el motivo, y queda una entrada en
-- `auditoria`. Un movimiento de plata que desaparece sin rastro es justo lo que un auditor busca.
-- Autorizado por Máximo el 2026-08-08.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- 1) El archivo. Guarda la fila COMPLETA como jsonb: si mañana hay que devolverla, está entera.
create table if not exists bnc_movimientos_reemplazados (
  id            text primary key,
  reemplazado_at timestamptz not null default now(),
  motivo        text not null,
  fila          jsonb not null
);
alter table bnc_movimientos_reemplazados enable row level security;
-- Tabla nueva: nace SIN permisos para anon (norma-tabla-nueva-revocar-anon).
revoke all on bnc_movimientos_reemplazados from anon;
grant select on bnc_movimientos_reemplazados to authenticated;

-- 2) Archivar las 5 estimaciones (las de factura de la Alcaldía dentro del período que cubre el
--    estado de cuenta). La 000638 del 05/08 NO se toca: está fuera del Excel.
insert into bnc_movimientos_reemplazados (id, motivo, fila)
select m.id,
       'Estimacion generada por la app al registrar el abono (total de la factura a la tasa del dia '
       || 'de CARGA). Reemplazada por los depositos REALES del banco, que vienen en dos partes '
       || '(~90% + 10% de fiel cumplimiento). Ver estado de cuenta de Aurelys, 2026-08-08.',
       to_jsonb(m)
from bnc_movimientos m
where m.id not like 'xls_%'
  and m.tipo = 'credito'
  and m.fecha between '2026-03-23' and '2026-07-31'
  and m.descripcion ilike 'Pago Alcaldia%'
on conflict (id) do nothing;

-- 3) Sacarlas de la tabla viva SOLO si quedaron archivadas.
delete from bnc_movimientos m
where m.id not like 'xls_%'
  and m.tipo = 'credito'
  and m.fecha between '2026-03-23' and '2026-07-31'
  and m.descripcion ilike 'Pago Alcaldia%'
  and exists (select 1 from bnc_movimientos_reemplazados r where r.id = m.id);

-- 4) Rastro en la auditoría de la app (es lo que le da credibilidad a los listados).
insert into auditoria (operador, accion, detalle)
select 'maxware (carga estado de cuenta)',
       'Movimientos BNC reemplazados por el estado de cuenta real',
       'Se archivaron ' || count(*) || ' estimaciones de pago de la Alcaldia y se reemplazaron por '
       || 'los depositos reales del banco (dos por factura: ~90% + 10% de fiel cumplimiento). '
       || 'Las filas originales quedan intactas en bnc_movimientos_reemplazados. '
       || 'Autorizado por Maximo el 2026-08-08.'
from bnc_movimientos_reemplazados
where reemplazado_at > now() - interval '5 minutes';

-- 5) Comprobación
select (select count(*) from bnc_movimientos_reemplazados)                            archivadas,
       (select count(*) from bnc_movimientos where descripcion ilike 'Pago Alcaldia%') quedan_en_la_tabla_viva,
       (select count(*) from bnc_movimientos)                                          total_movimientos;
