-- ============================================================================
-- EL ESPEJO TAMBIÉN CUENTA CUANDO NO TRAE REFERENCIA
-- 2026-10-20, el mismo día y unas horas después de `btg_espejo_del_abono_no_duplica`.
--
-- QUÉ SE LE ESCAPABA
-- La primera versión de `btg_es_espejo()` exigía que el movimiento tuviera
-- REFERENCIA, para emparejarlo con el del estado de cuenta (la del manual
-- aparece dentro de la del banco). Eso resolvió 7 casos… y dejó pasar los que la
-- app crea cuando el abono se registró SIN referencia: ahí no hay nada que
-- emparejar y el movimiento pasaba por un cobro más.
--
-- Costó un error real: viendo las facturas 000646 y 000647 con «dos pagos», se
-- les aplicó US$ 18.722,85 y US$ 10.885,28 como si faltara registrar la mitad.
-- No faltaba. Medido después, en bolívares, que es la moneda en que la plata
-- entra de verdad:
--
--   000646 · 25/09 · «a mano»  Bs 17.624.251,65  → 0 movimientos del banco así
--            25/09 · banco     Bs 16.020.444,75  ← el único cobro del IMAU ese día
--   000647 · 02/10 · «a mano»  Bs 10.434.644,70  → 0 movimientos del banco así
--            02/10 · banco     Bs  9.485.092,03  ← el único cobro del IMAU ese día
--
-- Un pago, valuado dos veces. Los abonos se devolvieron a su monto original.
--
-- ⛔ LA LECCIÓN: la regla miraba la REFERENCIA, y el caso que faltaba era
--    justamente el que NO la tiene. Una regla que se apoya en un campo opcional
--    deja afuera, en silencio, a todos los que lo tienen vacío.
--    [[norma-control-positivo-antes-de-creerle-al-vacio]]
--
-- LA REGLA, AHORA, POR DOS CAMINOS:
--   a) con referencia → la del manual aparece dentro de la del banco (±5 días);
--   b) SIN referencia → el texto dice de qué factura es, y el estado de cuenta
--      trae un cobro de ESA MISMA factura en ±5 días.
-- En los dos casos el manual sobra: la plata ya está contada por el banco.
-- ============================================================================

create or replace function btg_es_espejo(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select * from bnc_movimientos
     where id = p_id and control_number is null and cuenta is null
  )
  select exists (
    -- a) El camino de la REFERENCIA: el banco le antepone su propio prefijo.
    select 1 from m
      join bnc_movimientos r
        on r.control_number is not null
       and r.tipo = m.tipo
       and position(trim(m.referencia) in coalesce(r.referencia,'')) > 0
       and abs(r.fecha::date - m.fecha::date) <= 5
     where nullif(trim(coalesce(m.referencia,'')),'') is not null
    union all
    -- b) Sin referencia que comparar: manda el NÚMERO DE FACTURA del texto.
    --    Si el estado de cuenta ya trae un cobro de esa misma factura por esos
    --    días, este es el espejo — por más que los montos no coincidan, que es
    --    lo normal: cada uno se valuó con su propia tasa.
    select 1 from m
      join bnc_movimientos r
        on r.control_number is not null
       and r.tipo = m.tipo
       and abs(r.fecha::date - m.fecha::date) <= 5
       and btg_nro_factura(r.factura, r.descripcion, r.concepto_banco)
         = btg_nro_factura(m.factura, m.descripcion, m.concepto_banco)
     where nullif(trim(coalesce(m.referencia,'')),'') is null
       and btg_nro_factura(m.factura, m.descripcion, m.concepto_banco) is not null
  )
$$;

comment on function btg_es_espejo is
  'TRUE si este movimiento lo fabricó la app al registrar un abono y el estado de cuenta ya trajo el mismo cobro. Empareja por REFERENCIA contenida (±5 días) y, cuando el movimiento no tiene referencia, por NÚMERO DE FACTURA. Nunca por monto: cada uno se valúa con la tasa de su día.';
