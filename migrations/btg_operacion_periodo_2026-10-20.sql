-- ============================================================================
-- LA OPERACIÓN DEL PERÍODO — viajes, facturado y abonos, desde LA BASE
-- 2026-10-20.
--
-- POR QUÉ EXISTE
-- El bloque del costo por tonelada del informe sacaba los viajes de `REGS`, el
-- array del NAVEGADOR. Máximo abrió el informe y leyó:
--
--     «No hay viajes cargados entre 23/03/2026 y 20/10/2026»
--
-- …en una pantalla que dos renglones más abajo decía «3.185 viajes». En la base
-- hay **4.957 viajes** en ese rango. El dato estaba; lo que no estaba era en el
-- navegador, en ese momento.
--
-- ⛔ TODO EL INFORME SALE DE LA BASE MENOS ESE BLOQUE, Y POR ESO FALLÓ SOLO ÉL.
--    Mezclar una fuente del servidor con el estado del navegador hace que la
--    misma pantalla afirme dos cosas opuestas según cuándo se abra.
--    [[norma-fuente-unica-datos]]
--
-- ⛔ Y DEVUELVE `viajes_antes`: los viajes ANTERIORES al rango. Sin eso, el
--    informe no puede avisar que hay toneladas cuyo gasto no existe en ninguna
--    parte (el estado de cuenta arranca el 23/03 y las planillas el 04/03).
--
-- ⚠️ `abonos_usd` NO es «lo cobrado»: es lo que alguien alcanzó a REGISTRAR
--    contra una factura. Lo cobrado de verdad sale del banco. Al 20/10/2026 el
--    banco trae US$ 878.250 en 66 cobros y los abonos US$ 625.251 en 28: son
--    **US$ 252.999 que entraron y nadie aplicó**. El informe muestra el del
--    banco y DICE la diferencia, en vez de que dos pantallas se desmientan.
-- ============================================================================

create or replace function btg_operacion_periodo(p_desde text, p_hasta text)
returns table (
  viajes        bigint,
  facturado_usd numeric,
  planillas     bigint,
  primera       text,
  viajes_antes  bigint,   -- viajes ANTERIORES a p_desde (sin gasto que los respalde)
  abonos_usd    numeric,  -- lo REGISTRADO contra facturas (no es lo cobrado)
  abonos_n      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select sum(t) from planillas where f >= p_desde and f <= p_hasta),0),
    coalesce((select round(sum(m)::numeric,2) from planillas where f >= p_desde and f <= p_hasta),0),
    coalesce((select count(*) from planillas where f >= p_desde and f <= p_hasta),0),
    (select min(f) from planillas),
    coalesce((select sum(t) from planillas where f < p_desde),0),
    coalesce((select round(sum(m)::numeric,2) from abonos where f >= p_desde and f <= p_hasta),0),
    coalesce((select count(*) from abonos where f >= p_desde and f <= p_hasta),0)
$$;

-- Las dos tablas ya las lee la app con la sesión del usuario, así que agregarlas
-- no expone nada nuevo. Se cierra a `anon`, que no tiene por qué verlas.
revoke all on function btg_operacion_periodo(text,text) from anon, public;
grant execute on function btg_operacion_periodo(text,text) to authenticated;

comment on function btg_operacion_periodo is
  'Viajes, facturado y abonos de un período, desde la base. ⚠️ `abonos_usd` es lo REGISTRADO contra facturas, NO lo cobrado: lo cobrado sale del banco y al 20/10/2026 iba US$ 252.999 por encima de los abonos.';
