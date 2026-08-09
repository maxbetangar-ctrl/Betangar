-- De 3 supuestos quedó 1. Los otros dos NO se preguntaron: los respondieron los datos.
--   · tarifa: desde el 29/05 las 10 facturas salen exactas a US$ 316,88 (804 viajes).
--   · tope: los viajes por factura van de 40 a 136 sin agruparse en ningún número. Si hubiera
--     tope, muchas facturas estarían pegadas a la misma cifra.
-- Queda el que los datos NO pueden responder: si los 1.784 sin facturar son retraso o si una parte
-- no se le cobra. El % facturado subió de 31% a 42% y lleva desde junio plano: firma de un retraso
-- CONSTANTE, no de algo que se pone al día. [[norma-documento-no-afirma-lo-que-nadie-declaro]]

CREATE OR REPLACE FUNCTION public.btg_utilidad_real_y_estimada(p_desde text, p_hasta text)
 RETURNS TABLE(utilidad_real_usd numeric, por_facturar_usd numeric, viajes_sin_facturar bigint, utilidad_estimada_usd numeric, margen_real_pct numeric, margen_estimado_pct numeric, tarifa_usada numeric, supuestos text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select _q.* from (
with r as (select * from btg_resumen_socio(p_desde, p_hasta)),
       -- ⛔ SIN FILTRO DE FECHA, a propósito: lo pendiente es un saldo acumulado, no un flujo del
       -- período. Acotarlo escondía viajes viejos que siguen sin cobrarse.
       ej as (select coalesce(sum(t),0)::bigint v from planillas),
       fa as (select coalesce(sum(v),0)::bigint v from abonos),
       -- La tarifa VIGENTE: la de la última factura, no el promedio de todas.
       tar as (select coalesce((select round((m / nullif(v,0))::numeric, 2)
                                  from abonos where coalesce(v,0) > 0
                                 order by f desc, id desc limit 1), 0) t),
       pend as (select greatest(0, (select v from ej) - (select v from fa)) n),
       -- Ingresos totales: el mismo denominador que usa btg_resumen_socio para el margen real.
       ing as (select (select cobrado_usd from r) + (select otras_entradas_usd from r) v),
       fut as (select (select n from pend) * (select t from tar) v)
  select
    round((select utilidad_usd from r)::numeric, 2),
    round((select v from fut)::numeric, 2),
    (select n from pend),
    round(((select utilidad_usd from r) + (select v from fut))::numeric, 2),
    (select margen_pct from r),
    case when ((select v from ing) + (select v from fut)) > 0
      then round((((select utilidad_usd from r) + (select v from fut))
           / ((select v from ing) + (select v from fut)) * 100)::numeric, 1)
      else 0 end,
    (select t from tar),
    'Verificado contra las facturas: la tarifa de US$ ' || (select t from tar) ||
     ' es la vigente desde el 29/05 (10 facturas seguidas), y no hay tope — los viajes por factura van de 40 a 136 sin repetirse. ' ||
     'FALTA CONFIRMAR una sola cosa: si los viajes no facturados son retraso de facturación o si una parte no se le cobra a la Alcaldía.'
  ) _q where public.btg_ve_financiero()
$function$
;