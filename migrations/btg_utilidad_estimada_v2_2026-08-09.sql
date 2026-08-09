-- Lo ejecutado y no facturado: tres arreglos, todos del mismo tipo — números que se veían bien
-- porque el error los hacía MÁS CHICOS, no porque estuvieran cerrados.
--
-- 1) ⛔ EL PENDIENTE HEREDABA EL FILTRO DE FECHA DEL INFORME.
--    `ej` contaba planillas desde p_desde y `fa` abonos desde p_desde. El informe arranca el
--    23/03 porque es donde arranca el ESTADO DE CUENTA DEL BANCO — que es la fecha correcta para
--    el dinero y la equivocada para los viajes. Las planillas empiezan el 04/03: quedaban afuera
--    203 viajes ejecutados y solo 40 facturados, o sea **163 viajes netos ≈ US$ 51.650** que la
--    Alcaldía debe y el informe no mostraba.
--    Un viaje hecho el 10/03 y nunca facturado SIGUE sin facturarse hoy: no deja de existir
--    porque el estado de cuenta empiece después. Lo pendiente es un SALDO ACUMULADO, no un flujo
--    del período, y se cuenta completo. [[norma-pendiente-no-hereda-el-filtro-de-fecha]]
--    (Mismo error, el mismo día, en la hoja «Por revisar» del Excel de la relación.)
--
-- 2) ⛔ LA TARIFA ERA EL PROMEDIO HISTÓRICO Y DILUÍA.
--    Salía `sum(m)/sum(v)` de las 18 facturas = $316,42. Pero las 10 últimas —desde el 29/05—
--    son todas exactamente $316,88; las viejas van de $314,67 a $318,09 y arrastran el promedio.
--    Para valorar viajes que se facturarán EN EL FUTURO manda la tarifa VIGENTE, no el promedio
--    de lo que se cobró antes. Es el criterio que ya fijó Máximo para la brecha cambiaria: «no
--    puedes hacerla en línea a un porcentaje sino una a una, porque la brecha baja y sube».
--
-- 3) ⛔ LOS DOS MÁRGENES NO SE PODÍAN COMPARAR.
--    `margen_real_pct` divide entre los INGRESOS TOTALES (cobrado + otras entradas) — así lo
--    calcula btg_resumen_socio. `margen_estimado_pct` dividía entre cobrado + por facturar,
--    dejando fuera las otras entradas. Dos porcentajes con distinto denominador puestos uno al
--    lado del otro: el socio los resta y no le da.
--    Ahora los dos miden contra los ingresos totales.
--
-- Efecto: por_facturar pasa de US$ 512.917 a US$ 565.320 (1.784 viajes, no 1.621).

CREATE OR REPLACE FUNCTION public.btg_utilidad_real_y_estimada(p_desde text, p_hasta text)
RETURNS TABLE(utilidad_real_usd numeric, por_facturar_usd numeric, viajes_sin_facturar bigint,
              utilidad_estimada_usd numeric, margen_real_pct numeric, margen_estimado_pct numeric,
              tarifa_usada numeric, supuestos text)
LANGUAGE sql STABLE AS $$
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
    'Sin confirmar: (1) que todos los viajes de la planilla sean facturables a la Alcaldía, (2) que la tarifa de US$ ' ||
      (select t from tar) || ' aplique a todos, (3) que no haya un tope de lo que la Alcaldía reconoce por semana.'
$$;

revoke all on function public.btg_utilidad_real_y_estimada(text,text) from public, anon;
grant execute on function public.btg_utilidad_real_y_estimada(text,text) to authenticated;
