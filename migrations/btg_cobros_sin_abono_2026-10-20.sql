-- ============================================================================
-- LOS COBROS QUE ENTRARON Y NADIE APLICÓ — conciliación por NÚMERO DE FACTURA
-- 2026-10-20.
--
-- POR QUÉ EXISTE
-- Máximo vio dos «cobrados» distintos en el sistema y preguntó cuál era. Los dos
-- eran correctos y medían cosas distintas:
--
--   BANCO  (cobro_alcaldia, 23/03→20/10) : US$ 878.250 en 66 movimientos
--   ABONOS (aplicados a una factura)     : US$ 612.579 en 27
--
-- La diferencia son **15 cobros de la Alcaldía, US$ 259.918**, que entraron a la
-- cuenta y nadie registró contra una factura. No es un número en pelea: es
-- trabajo de carga que nadie podía ver porque ninguna pantalla lo listaba.
-- Máximo, 20/10/2026: «eso debe repararse en el sistema».
--
-- ⛔ YA HABÍA UNA PIEZA Y MIRABA DONDE NO DEBÍA. `verificarBNCvsAbonos()` lee las
--    **últimas 5 notificaciones no procesadas** —no el estado de cuenta— y casa
--    **por MONTO con tolerancia de $50** contra semanas abiertas. Dos problemas:
--    no puede ver 15 cobros históricos, y el monto NO identifica: en septiembre
--    hay dos cobros de US$ 17.112 (04/09 y 07/09). Casar por el número que se
--    repite es como se cuelga un pago en la factura de otro.
--    [[norma-la-palabra-que-identifica-es-la-rara]]
--
-- ⛔ SE CASA POR EL NÚMERO DE FACTURA, que es el dato RARO, y el banco ya lo
--    escribe en el concepto: «Pago Alcaldia Fact.000643», «INGRESO IMAU FACTURA
--    001005», «fc segun factura». La columna `factura` solo está llena en 51 de
--    66 — justo en los 15 que faltan no se extrajo —, así que acá se lee del
--    TEXTO y no se depende de que alguien la haya rellenado antes.
--
-- ⛔ ESTO NO ESCRIBE NADA. Lista lo que falta para que una persona lo aplique.
--    Crear abonos solos es escribir plata a partir de una coincidencia de texto;
--    si algún día se hace, va con confirmación y con el candado de la factura.
-- ============================================================================

-- El número de factura que trae un movimiento, mirando primero la columna ya
-- extraída y después el texto del banco. Devuelve 6 dígitos con ceros adelante,
-- que es como se escriben en `abonos.fact` ('000643').
create or replace function btg_nro_factura(p_factura text, p_desc text, p_concepto text)
returns text
language sql
immutable
as $$
  with t as (select upper(coalesce(p_desc,'') || ' ' || coalesce(p_concepto,'')) txt),
  n as (
    select coalesce(
      nullif(regexp_replace(coalesce(p_factura,''), '\D', '', 'g'), ''),
      -- «Fact.000643» · «FACT 000643» · «FACTURA 001005» · «FC 00631»
      (select (regexp_match(txt, '(?:FACT(?:URA)?|FC)[^0-9]{0,6}([0-9]{4,8})'))[1] from t)
    ) v
  )
  select case when v is null or v = '' then null
              else lpad(regexp_replace(v, '^0+', ''), 6, '0') end
  from n
$$;

comment on function btg_nro_factura is
  'El número de factura de un movimiento del banco: primero la columna ya extraída, si no el TEXTO del concepto. ⛔ No se depende de que alguien haya rellenado `factura`: está llena en 51 de 66 y justo faltaba en los que no tienen abono.';

-- ---------------------------------------------------------------------------
create or replace function btg_cobros_sin_abono(p_desde text, p_hasta text)
returns table (
  fecha      date,
  usd        numeric,
  bs         numeric,
  factura    text,
  texto      text,
  referencia text,
  por_que    text     -- 'sin abono para esa factura' | 'el banco no dice la factura'
)
language sql
stable
security definer
set search_path = public
as $$
  with cob as (
    select b.fecha::date f,
           round((b.monto / nullif(btg_tasa_mov(b.fecha::date, b.tasa_real, b.categoria),0))::numeric, 2) usd,
           round(b.monto::numeric,2) bs,
           btg_nro_factura(b.factura, b.descripcion, b.concepto_banco) nro,
           left(coalesce(nullif(trim(b.descripcion),''), b.concepto_banco, ''), 140) txt,
           coalesce(b.referencia,'') ref
      from bnc_movimientos b
     where b.tipo = 'credito' and b.categoria = 'cobro_alcaldia'
       and b.fecha >= p_desde and b.fecha <= p_hasta
  )
  select c.f, c.usd, c.bs, c.nro, c.txt, c.ref,
         case when c.nro is null then 'el banco no dice la factura'
              else 'sin abono para esa factura' end
    from cob c
   where c.nro is null
      or not exists (
        select 1 from abonos a
         where nullif(trim(a.fact),'') is not null
           and lpad(regexp_replace(regexp_replace(a.fact, '\D', '', 'g'), '^0+', ''), 6, '0') = c.nro
      )
   order by c.usd desc nulls last
$$;

revoke all on function btg_cobros_sin_abono(text,text) from anon, public;
grant execute on function btg_cobros_sin_abono(text,text) to authenticated;

comment on function btg_cobros_sin_abono is
  'Cobros de la Alcaldía que entraron al banco y NO tienen un abono aplicado a esa factura. Se casa por el NÚMERO DE FACTURA, no por el monto: en septiembre hay dos cobros de US$ 17.112 y el monto no identifica. No escribe nada: lista lo que falta cargar.';
