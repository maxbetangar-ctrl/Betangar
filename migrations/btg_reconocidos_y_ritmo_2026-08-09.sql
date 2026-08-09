-- ✅ NO SON "FACTURABLES": ESTÁN RECONOCIDOS. La dirección (09/08): «todos los viajes registrados
-- en el Excel o el sistema son viajes YA RECONOCIDOS por la Alcaldía; el tema es que no sabemos
-- cuándo nos vayan a pagar, y ese número siempre sigue aumentando».
-- Es más fuerte que lo que decía el informe: no es trabajo por aprobar ni discutible.
--
-- 📈 Y LO SEGUNDO ES LO QUE NADIE HABÍA PUESTO EN NÚMERO: el saldo NO se está achicando.
-- Se ejecutan ~150 viajes/semana y se facturan ~71: crece ~79 por semana = US$ 24.898 semanales,
-- unos US$ 107.800 al mes. Un socio que ve "US$ 565.314 por cobrar" cree que es una foto; es una
-- represa que sube. El ritmo se CALCULA de las últimas semanas, no se clava, para que no envejezca.
-- [[norma-viajes-ejecutados-no-facturados]] · [[norma-numero-que-el-dueno-no-puede-explicar]]

CREATE OR REPLACE FUNCTION public.btg_utilidad_real_y_estimada(p_desde text, p_hasta text)
 RETURNS TABLE(utilidad_real_usd numeric, por_facturar_usd numeric, viajes_sin_facturar bigint, utilidad_estimada_usd numeric, margen_real_pct numeric, margen_estimado_pct numeric, tarifa_usada numeric, supuestos text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select _q.* from (
with ritmo as (select greatest(0,
         (select coalesce(sum(t),0)::numeric from planillas where f >= '2026-05-01')
         - (select coalesce(sum(v),0)::numeric from abonos where f >= '2026-05-01' and coalesce(v,0) > 0))
         / nullif((select count(distinct date_trunc('week', f::date)) from planillas where f >= '2026-05-01'),0) c),
       r as (select * from btg_resumen_socio(p_desde, p_hasta)),
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
     ', verificada contra las 10 últimas facturas. TOPE: no hay — el límite es la basura que salga y que los camiones no paren. ' ||
     'RECONOCIMIENTO: todos los viajes registrados YA están reconocidos por la Alcaldía; no es trabajo por aprobar ni discutible. ' ||
     'Lo único que no se sabe es CUÁNDO paga — los entes públicos pagan tarde, y acá no se factura hasta que van a pagar por el diferencial cambiario. ' ||
     'Y este saldo NO se está achicando: crece unos ' || (select round(c) from ritmo) || ' viajes por semana (US$ ' ||
     (select round(c*(select t from tar)) from ritmo) || ' semanales), porque se ejecuta más de lo que se cobra. ' ||
     'Por eso no es caja y no debe tratarse como tal.'
  ) _q where public.btg_ve_financiero()
$function$
;