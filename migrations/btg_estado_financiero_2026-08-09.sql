-- ============================================================================
-- Betangar · EL ESTADO FINANCIERO REAL — la fuente única del número que ve el socio
-- 2026-08-09.
--
-- POR QUÉ EXISTE
-- Máximo: «si ya tenemos todos los gastos, todas las compras de dólares y
-- tenemos todo, el dashboard y todas las cosas deberían estar actualizadas…
-- y ahorita siento que no es así». Tenía razón. Medido:
--
--   Gasto real que salió del banco (23/03→09/08) : US$ 310.553
--   Lo que veían las tablas de la app            : US$ 121.531
--   Gasto real que NINGÚN cuadro contaba         : US$ 189.022  (61%)
--
-- La Utilidad Real se calculaba sumando NUEVE tablas que alguien tiene que
-- teclear (gastos fijos, variables, CxP, multas…). Categorías enteras no
-- tenían dónde registrarse: Comisión 1B (US$ 25.107), Servicios (US$ 23.726),
-- Responsabilidad social (US$ 12.745), Impuestos (US$ 10.186). No estaban mal
-- calculadas: NO ESTABAN. El socio leía una ganancia que no existía.
--
-- EL CAMBIO DE FONDO: el gasto ya no depende de que alguien lo escriba.
-- Sale del banco, que es donde la plata se movió de verdad, ya clasificado y
-- con `es_gasto` decidido movimiento por movimiento.
--
-- ⛔ CADA MOVIMIENTO A LA TASA DE SU DÍA, NUNCA UN PROMEDIO. De marzo a agosto
-- la tasa pasó de 466 a 742: un promedio no describe ninguna operación real.
-- [[motor-bolivares-dolares-todas-las-empresas]]
--
-- ⛔ LO QUE SALE DEL BANCO NO ES TODO GASTO. La compra de dólares es AHORRO y
-- el traspaso entre cuentas propias es la misma plata cambiando de bolsillo.
-- Van en un bloque aparte —movimientos patrimoniales— porque el socio tiene
-- que ver que la plata existe, no que se gastó. [[norma-salida-de-banco-no-es-gasto]]
--
-- ⚠️ SIN TASA NO SE CONVIERTE, Y SE DICE. Los movimientos sin tasa del día no
-- entran en los totales y se cuentan aparte en `sin_tasa`. Inventar una tasa
-- para que el cuadro cierre es exactamente lo que hace mentir a un cuadro.
-- ============================================================================

-- La tasa que corresponde a una fecha: la de ese día, o la del último día hábil
-- anterior (el BCV no publica fines de semana ni feriados). Una sola definición.
create or replace function btg_tasa_de(f date)
returns numeric language sql stable as $$
  select bcv_dolar from tasas_diarias
   where fecha <= f and bcv_dolar > 0
   order by fecha desc limit 1
$$;

comment on function btg_tasa_de is
  'La tasa BCV que aplica a una fecha. Si el BCV no publicó ese día, la del último hábil anterior. Devuelve NULL si no hay ninguna: ahí NO se convierte.';

-- ---------------------------------------------------------------------------
-- EL ESTADO FINANCIERO. Una fila por concepto, agrupada como lo lee un socio:
-- primero de dónde vino la plata, después qué costó operar, después lo que la
-- empresa debe pagar sí o sí, y al final lo que se lleva el socio.
-- ---------------------------------------------------------------------------
create or replace function btg_estado_financiero(p_desde text, p_hasta text)
returns table (
  bloque      text,      -- INGRESOS | OPERACION | ADMINISTRACION | OBLIGACIONES | SOCIO | PATRIMONIAL
  orden       int,       -- para que el cuadro salga siempre en el mismo orden
  concepto    text,
  movimientos bigint,
  bs          numeric,
  usd         numeric,
  sin_tasa    bigint     -- cuántos NO se pudieron convertir (no entran en usd)
)
language sql
security definer
set search_path = public
as $$
  with m as (
    select b.*, btg_tasa_de(b.fecha::date) tasa
      from bnc_movimientos b
     where b.fecha >= p_desde and b.fecha <= p_hasta
  ),
  cat as (
    select
      case
        when tipo='credito' and categoria='cobro_alcaldia'                     then 'INGRESOS'
        when tipo='credito' and categoria in ('otro_ingreso','reverso')        then 'INGRESOS'
        when categoria in ('nomina','combustible','mantenimiento','dotacion')  then 'OPERACION'
        when categoria in ('servicios','alquiler','seguro','compra_software','software',
                           'tramites','caja_chica','bienestar_personal','comision_banco',
                           'implantacion_maxware','reembolso','otro','sin_clasificar',
                           'duplicado','⏳pendiente_explicar')                  then 'ADMINISTRACION'
        when categoria in ('impuestos','resp_social','parafiscales')           then 'OBLIGACIONES'
        when categoria in ('pago_socio','asignacion_1b')                       then 'SOCIO'
        else 'PATRIMONIAL'
      end bloque,
      case
        when tipo='credito' and categoria='cobro_alcaldia'          then 'Cobrado a la Alcaldía'
        when tipo='credito' and categoria='reverso'                 then 'Devoluciones recibidas'
        when tipo='credito'                                         then 'Otras entradas'
        when categoria='nomina'              then 'Nómina'
        when categoria='combustible'         then 'Combustible'
        when categoria='mantenimiento'       then 'Mantenimiento de unidades'
        when categoria='dotacion'            then 'Dotación y uniformes'
        when categoria='servicios'           then 'Servicios'
        when categoria='alquiler'            then 'Alquiler'
        when categoria='seguro'              then 'Seguros'
        when categoria in ('compra_software','software') then 'Software'
        when categoria='tramites'            then 'Trámites y permisos'
        when categoria='caja_chica'          then 'Caja chica'
        when categoria='bienestar_personal'  then 'Bienestar del personal'
        when categoria='comision_banco'      then 'Comisiones bancarias'
        when categoria='implantacion_maxware' then 'Apoyo administrativo'
        when categoria='reembolso'           then 'Reembolsos'
        when categoria='impuestos'           then 'Impuestos y retenciones'
        when categoria='resp_social'         then 'Responsabilidad social'
        when categoria='parafiscales'        then 'Parafiscales'
        when categoria='pago_socio'          then 'Pago a socio (7% + 0,5%)'
        when categoria='asignacion_1b'       then 'Comisión 1B'
        when categoria='compra_divisas'      then 'Compra de dólares (ahorro, NO gasto)'
        when categoria='prestamo_empleado'   then 'Préstamos a empleados (se recuperan)'
        when categoria='traspaso_interno'    then 'Traspasos entre cuentas propias'
        when categoria='prueba_sistema'      then 'Pruebas del sistema (no es plata)'
        else coalesce(categoria,'Sin clasificar')
      end concepto,
      monto, tasa
    from m
  )
  select bloque,
         case bloque when 'INGRESOS' then 1 when 'OPERACION' then 2 when 'ADMINISTRACION' then 3
                     when 'OBLIGACIONES' then 4 when 'SOCIO' then 5 else 6 end,
         concepto,
         count(*),
         round(sum(monto)::numeric, 2),
         round(sum(monto / nullif(tasa,0))::numeric, 2),
         count(*) filter (where tasa is null)
    from cat
   group by 1,2,3
   order by 2, 6 desc
$$;

revoke all on function btg_estado_financiero(text,text) from anon, public;
grant execute on function btg_estado_financiero(text,text) to authenticated;

comment on function btg_estado_financiero is
  'El estado financiero REAL del período, sacado del banco. Cada movimiento a la tasa de SU día. El bloque PATRIMONIAL sale del banco pero NO es gasto: es plata que sigue siendo de la empresa.';

-- ---------------------------------------------------------------------------
-- EL RESUMEN DE UNA LÍNEA — lo que va en el dashboard y en el mensaje semanal.
-- ---------------------------------------------------------------------------
create or replace function btg_resumen_socio(p_desde text, p_hasta text)
returns table (
  cobrado_usd        numeric,
  otras_entradas_usd numeric,
  gasto_usd          numeric,
  utilidad_usd       numeric,
  margen_pct         numeric,
  ahorro_divisas_usd numeric,
  operacion_usd      numeric,
  administracion_usd numeric,
  obligaciones_usd   numeric,
  socio_usd          numeric,
  movs_sin_tasa      bigint
)
language sql
security definer
set search_path = public
as $$
  with e as (select * from btg_estado_financiero(p_desde, p_hasta))
  select
    coalesce((select sum(usd) from e where bloque='INGRESOS' and concepto='Cobrado a la Alcaldía'),0),
    coalesce((select sum(usd) from e where bloque='INGRESOS' and concepto<>'Cobrado a la Alcaldía'),0),
    coalesce((select sum(usd) from e where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO')),0),
    coalesce((select sum(usd) from e where bloque='INGRESOS'),0)
      - coalesce((select sum(usd) from e where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO')),0),
    case when coalesce((select sum(usd) from e where bloque='INGRESOS'),0) > 0
      then round(((coalesce((select sum(usd) from e where bloque='INGRESOS'),0)
                 - coalesce((select sum(usd) from e where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO')),0))
                 / (select sum(usd) from e where bloque='INGRESOS') * 100)::numeric, 1)
      else 0 end,
    coalesce((select sum(usd) from e where concepto like 'Compra de dólares%'),0),
    coalesce((select sum(usd) from e where bloque='OPERACION'),0),
    coalesce((select sum(usd) from e where bloque='ADMINISTRACION'),0),
    coalesce((select sum(usd) from e where bloque='OBLIGACIONES'),0),
    coalesce((select sum(usd) from e where bloque='SOCIO'),0),
    coalesce((select sum(sin_tasa) from e),0)
$$;

revoke all on function btg_resumen_socio(text,text) from anon, public;
grant execute on function btg_resumen_socio(text,text) to authenticated;

comment on function btg_resumen_socio is
  'Una línea con lo que un socio pregunta: cuánto entró, cuánto se gastó de verdad, cuánto quedó, y cuánto de lo que salió NO se gastó (está en dólares).';
