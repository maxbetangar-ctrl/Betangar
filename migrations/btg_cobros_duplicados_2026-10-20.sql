-- ============================================================================
-- EL MISMO COBRO, DOS VECES — y por eso la utilidad está inflada
-- 2026-10-20.
--
-- QUÉ SE ENCONTRÓ (medido, no supuesto)
-- Máximo preguntó por qué el sistema le mostraba dos «cobrados» distintos
-- (US$ 878.250 del banco contra US$ 612.579 de abonos). Buscando la diferencia
-- apareció algo peor que una carga pendiente:
--
--   Cobros de la Alcaldía 23/03→20/10 .... 66 movimientos · US$ 878.250
--     · del ESTADO DE CUENTA ............. 56 movimientos · US$ 665.326
--     · cargados A MANO .................. 10 movimientos · US$ 212.924
--       de esos, con GEMELO en el estado
--       de cuenta ........................  7 movimientos · US$ 168.244  ← dos veces
--
-- Ejemplo, factura 000639:
--   11/08  «Pago Alcaldia Fact.000639»   ref 00378645             US$ 42.145
--   12/08  «TRANSFERENCIA RECIBIDA...»   ref 209282300378645/...  US$ 38.028
--   13/08  «fc segun factura IMAU»                                US$  4.183
-- La referencia del cargado a mano está DENTRO de la del movimiento real, con
-- un día de diferencia, y 38.028 + 4.183 = 42.211 ≈ los 42.145. Es el mismo
-- dinero anotado dos veces: una por una persona y otra por el estado de cuenta.
--
-- ⛔ CONSECUENCIA: el «Cobrado» del informe y por lo tanto la UTILIDAD están
--    inflados en ~US$ 168.244 mientras esto no se resuelva. Un ingreso contado
--    dos veces no se nota: la cifra queda creíble y más alta.
--    [[norma-numero-que-el-dueno-no-puede-explicar]]
--
-- ⛔ ESTO NO BORRA NADA. Lista los pares para que una persona decida cuál queda.
--    Borrar movimientos del estado de cuenta es tocar la plata, y el que decide
--    es el dueño. [[norma-arreglar-el-mecanismo-no-el-caso]] — el mecanismo que
--    falta es que cargar un cobro a mano avise si ya está en el estado de cuenta.
--
-- CÓMO SE RECONOCEN, y por qué no por el monto:
--   · el cargado A MANO no trae `control_number` ni `cuenta` (el estado de
--     cuenta siempre los trae);
--   · su `referencia` está CONTENIDA en la del movimiento real — el banco le
--     antepone su propio prefijo;
--   · las fechas caen dentro de 5 días.
--   El MONTO no sirve para emparejar: cambia con la tasa del día en que se
--   registró cada uno, y además hay montos repetidos (dos cobros de US$ 17.112
--   en septiembre). [[norma-la-palabra-que-identifica-es-la-rara]]
-- ============================================================================

create or replace function btg_cobros_duplicados(p_desde text, p_hasta text)
returns table (
  id_a_mano    text,
  fecha_a_mano date,
  usd_a_mano   numeric,
  texto_a_mano text,
  ref_a_mano   text,
  id_real      text,
  fecha_real   date,
  usd_real     numeric,
  texto_real   text
)
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select b.*, (b.monto / nullif(btg_tasa_mov(b.fecha::date, b.tasa_real, b.categoria),0)) usd
      from bnc_movimientos b
     where b.tipo = 'credito' and b.categoria = 'cobro_alcaldia'
       and b.fecha >= p_desde and b.fecha <= p_hasta
  ),
  mano as (select * from m where control_number is null and cuenta is null
             and nullif(trim(referencia),'') is not null),
  real_ as (select * from m where control_number is not null)
  select mano.id, mano.fecha::date, round(mano.usd::numeric,2),
         left(coalesce(mano.descripcion, mano.concepto_banco, ''),80), mano.referencia,
         r.id, r.fecha::date, round(r.usd::numeric,2),
         left(coalesce(r.descripcion, r.concepto_banco, ''),80)
    from mano
    join lateral (
      select * from real_ r
       where position(trim(mano.referencia) in coalesce(r.referencia,'')) > 0
         and abs(r.fecha::date - mano.fecha::date) <= 5
       order by abs(r.fecha::date - mano.fecha::date)
       limit 1
    ) r on true
   order by mano.usd desc
$$;

revoke all on function btg_cobros_duplicados(text,text) from anon, public;
grant execute on function btg_cobros_duplicados(text,text) to authenticated;

comment on function btg_cobros_duplicados is
  'Cobros de la Alcaldía anotados DOS veces: uno cargado a mano y el mismo traído del estado de cuenta. Se emparejan por REFERENCIA contenida y fecha cercana, nunca por monto (cambia con la tasa del día y hay montos repetidos). No borra nada: lista los pares para que el dueño decida.';
