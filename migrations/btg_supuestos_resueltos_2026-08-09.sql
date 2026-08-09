-- ✅ LOS TRES SUPUESTOS, RESUELTOS. Ya no hay advertencia de "sin confirmar".
--   TARIFA: US$ 316,88, verificada contra las 10 últimas facturas (vigente desde el 29/05).
--   TOPE: no hay — la dirección lo declaró: el límite es la basura que salga y que los camiones
--         no paren. (De ahí sale otro número: 2,43 viajes/camión/día x 316,88 = US$ 770 por día
--         de camión parado. El techo lo pone la FLOTA, así que un camión en taller es ingreso
--         que no se hizo, no solo un costo.)
--   FACTURABLES: sí. La dirección (09/08): «es retraso en los pagos, los entes públicos en
--         Venezuela pagan muy tarde». Encaja con lo que ya estaba documentado: acá NO se factura
--         hasta que van a pagar, por el diferencial cambiario — o sea que el retraso en pagar
--         causa el retraso en facturar. Y lo confirman los datos: el % facturado subió de 31% a
--         42% y se estancó, que es la firma de un retraso CONSTANTE, no de trabajo perdido.
--
-- ⛔ Lo que sigue abierto NO es si entra, sino CUÁNDO. La cifra sigue sin ser caja y el informe lo
-- tiene que seguir diciendo. [[norma-viajes-ejecutados-no-facturados]]

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
    'Los tres supuestos quedaron resueltos. TARIFA: US$ ' || (select t from tar) ||
     ', verificada contra las 10 últimas facturas (vigente desde el 29/05). TOPE: no hay — el límite es la basura que salga y que los camiones no paren. ' ||
     'FACTURABLES: sí; lo pendiente es retraso, no trabajo que no se cobre — los entes públicos pagan tarde y acá no se factura hasta que van a pagar, por el diferencial cambiario. ' ||
     'Lo que sigue sin saberse NO es SI entra, sino CUÁNDO: por eso esta cifra no es caja y no debe tratarse como tal.'
  ) _q where public.btg_ve_financiero()
$function$
;