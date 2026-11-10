-- ═══════════════════════════════════════════════════════════════════════════════
-- LA INTERVENCIÓN CAMBIARIA SE CONCILIA SOLA — 10/11/2026
--
-- Máximo: «¿cómo evitamos que pase de nuevo?», después de cazar con una pregunta
-- —«¿salieron 4 millones para gasoil en UNA sola transferencia?»— que yo había
-- sacado de compra de dólares una compra real de US$ 4.600.
--
-- ⛔ QUÉ PASÓ, Y POR QUÉ NINGUNA REGLA DE TEXTO LO IBA A EVITAR. El banco le COPIA
--    a las tres líneas de la intervención el concepto de la transferencia vecina.
--    O sea que `concepto_banco` puede decir literalmente cualquier cosa en esas
--    filas: el 02/11 decía «GASOIL 2400 LTS» y el 30/10 nombraba una cuenta PROPIA
--    de Betangar. Los dos me hicieron clasificar mal, en direcciones distintas.
--    Leer mejor ese campo no arregla nada: el campo miente por diseño del banco.
--
-- ✅ PERO LA OPERACIÓN TRAE SU PROPIA PRUEBA. Llega en TRES líneas:
--      Cargo    Intervencion Cambiaria  → los bolívares que salen
--      Comision Intervencion Cambiar    → el 0,5% del cargo
--      Abono    Intervencion Cambiaria  → los DÓLARES que entran (moneda USD)
--    ⇒ `cargo / abono` ES la tasa, exacta, sin BCV y sin interpretar texto.
--    ⇒ `comision / cargo` tiene que dar 0,5%.
--    Medido sobre las 7 intervenciones de la historia: **las 7 cuadran al decimal**,
--    comisión 0,500% en todas. Es un invariante de verdad, no una heurística.
--
-- 📌 LA DIFERENCIA DE FONDO: los dólares comprados NUNCA hubo que deducirlos. Están
--    escritos en el Abono. Todo el error vino de calcularlos (`monto / tasa_real`)
--    teniendo el número al lado. [[norma-falta-de-dato-no-es-un-dato]]
--
-- Qué deja montado:
--   1. `bnc_intervenciones_descuadradas()` — devuelve filas SOLO cuando algo no
--      cierra. Si devuelve vacío, las intervenciones están sanas.
--   2. Una nota en la columna `concepto_banco`, para que el próximo que la lea
--      sepa que en estas filas no se le puede creer.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- 1. EL CHEQUEO
-- ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bnc_intervenciones_descuadradas()
 RETURNS TABLE(fecha text, cargo_id text, bs numeric, usd numeric,
               tasa_implicita numeric, tasa_guardada numeric,
               comision_pct numeric, categoria text, problema text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with cargo as (
    select m.id, substring(m.fecha from 1 for 10) as f, m.monto as bs,
           m.tasa_real, m.categoria
    from public.bnc_movimientos m
    where m.tipo = 'debito'
      and coalesce(m.tipo_banco,'') ilike '%Cargo Intervencion Cambiaria%'
  ), abono as (
    select substring(fecha from 1 for 10) as f, sum(monto) as usd
    from public.bnc_movimientos
    where tipo = 'credito'
      and coalesce(tipo_banco,'') ilike '%Abono Intervencion Cambiaria%'
      and coalesce(moneda,'') = 'USD'
    group by 1
  ), comi as (
    select substring(fecha from 1 for 10) as f, sum(monto) as c
    from public.bnc_movimientos
    where tipo = 'debito'
      and coalesce(tipo_banco,'') ilike '%Comision Intervencion%'
    group by 1
  )
  select c.f, c.id, c.bs, a.usd,
         (c.bs / nullif(a.usd,0))::numeric(14,4),
         c.tasa_real,
         (co.c / nullif(c.bs,0) * 100)::numeric(8,3),
         c.categoria,
         -- ⛔ Se dice QUÉ no cierra, no «hay un problema». Un aviso que no nombra
         --    la causa manda a investigar de cero. [[norma-la-barra-que-no-dice-que-sigue]]
         case
           when a.usd is null then
             'No tiene su Abono en dolares. Sin el no se sabe cuantos dolares entraron, y la tasa quedaria adivinada.'
           when c.categoria is distinct from 'compra_divisas' then
             'Es un Cargo de intervencion pero esta como «' || coalesce(c.categoria,'sin categoria') ||
             '». OJO: su concepto puede decir cualquier cosa, el banco se lo copia de otra transferencia.'
           when c.tasa_real is null then
             'Le falta la tasa, y se puede calcular exacta: ' || (c.bs / nullif(a.usd,0))::numeric(14,4) || ' (cargo / abono).'
           when abs(c.tasa_real - c.bs / nullif(a.usd,0)) > 0.01 then
             'La tasa guardada (' || c.tasa_real || ') no es la de la operacion (' ||
             (c.bs / nullif(a.usd,0))::numeric(14,4) || ' = cargo / abono). Mandan los dolares que ENTRARON.'
           when co.c is null then
             'No tiene su Comision de intervencion. Las 7 de la historia la traen, al 0,500%.'
           when abs(co.c / nullif(c.bs,0) * 100 - 0.5) > 0.01 then
             'La comision no da 0,5% del cargo (da ' || (co.c / nullif(c.bs,0) * 100)::numeric(8,3) ||
             '%). O falta una linea, o hay dos operaciones el mismo dia y se estan sumando.'
         end
  from cargo c
  left join abono a on a.f = c.f
  left join comi  co on co.f = c.f
  where a.usd is null
     or c.categoria is distinct from 'compra_divisas'
     or c.tasa_real is null
     or abs(c.tasa_real - c.bs / nullif(a.usd,0)) > 0.01
     or co.c is null
     or abs(co.c / nullif(c.bs,0) * 100 - 0.5) > 0.01
  order by c.f;
$function$;

COMMENT ON FUNCTION public.bnc_intervenciones_descuadradas() IS
'Las intervenciones cambiarias que NO cuadran. Vacio = sanas. La operacion llega en tres lineas (Cargo en Bs, Comision 0,5%, Abono en US$) y cargo/abono ES la tasa exacta: no hace falta BCV ni leer el concepto, que en estas filas el banco lo copia de otra transferencia. Medido el 10/11/2026: las 7 de la historia cuadran al decimal.';

-- ───────────────────────────────────────────────────────────────────────────────
-- 2. QUE EL CAMPO AVISE QUE MIENTE
-- ⛔ Esto no es documentacion de adorno: yo lei ese campo, arme una historia
--    coherente y escribi en la base de un cliente. El proximo que lo lea -persona
--    o agente- tiene que encontrarse el aviso ANTES, no despues.
-- ───────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.bnc_movimientos.concepto_banco IS
'El concepto que manda el banco. ⛔ NO ES CONFIABLE PARA SABER QUE ES EL MOVIMIENTO EN LAS LINEAS DE INTERVENCION CAMBIARIA: el banco les copia el concepto de la transferencia vecina. El 02/11/2026 las tres lineas de una compra de US$ 4.600 decian «GASOIL 2400 LTS PRECIO 065», que era de OTRA transferencia; el 30/10 nombraban una cuenta propia de Betangar y el cargo quedo como traspaso interno, escondiendo US$ 12.000 comprados. Para el TIPO de operacion manda `tipo_banco`; para los dolares, el Abono. Lo que si sirve del concepto es la tasa declarada a mano (`15000DL 1000T`), y aun asi exigiendo las dos cifras y que coincidan, porque las lineas hermanas lo arrastran igual.';
