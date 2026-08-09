-- ⛔ NO HAY TOPE DE VIAJES. Confirmado por la dirección (09/08): «no hay límites de viajes, el
-- límite es la cantidad de basura que salga o que los camiones no paren».
-- Los datos ya lo sugerían (40 a 136 viajes por factura, sin agruparse en ningún número), pero una
-- cosa es que no haya rastro y otra que alguien lo DECLARE. Ahora está declarado, y el informe lo
-- dice como confirmado en vez de como inferencia. [[norma-documento-no-afirma-lo-que-nadie-declaro]]
--
-- 📌 CONSECUENCIA OPERATIVA, y vale plata: si el techo lo pone la FLOTA y no el contrato, cada día
-- de camión parado NO es solo un costo de taller: es ingreso que no se hizo. Con el promedio real
-- de 2,43 viajes por camión y día × US$ 316,88 = US$ 770 por camión y por día.

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
    'TARIFA verificada contra las facturas: US$ ' || (select t from tar) ||
     ' es la vigente desde el 29/05 (10 facturas seguidas). TOPE: no hay — confirmado por la dirección, el límite es la basura que salga y que los camiones no paren. ' ||
     'FALTA CONFIRMAR una sola cosa: si los viajes no facturados son retraso de facturación o si una parte no se le cobra a la Alcaldía.'
  ) _q where public.btg_ve_financiero()
$function$
;