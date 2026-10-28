-- ════════════════════════════════════════════════════════════════════════════════════════════
-- RESUMEN SEMANAL PARA LOS SOCIOS — Betangar · 28/10/2026
--
-- 🔬 POR QUÉ EXISTE. Máximo, 28/10/2026: «mi socio Jonaz y Alejandro están necesitando
--    semanalmente un resumen que les llegue de manera automática de qué entró desde el momento
--    del pago de la alcaldía esta semana y qué salió [...] la alcaldía pagó tanto, tanto se fue
--    en combustible, tanto en nómina, tanto en pago a proveedores —que se le pagó tanto a cada
--    proveedor—, se compraron tantos dólares, que le abonaron a los camiones».
--
--    El ciclo del negocio NO es la semana del calendario: arranca cuando la Alcaldía paga. Por
--    eso el período lo marca el COBRO, no el lunes. (Decidido por Máximo el 28/10 sobre los
--    pagos reales: 02/10, 07/10, 13/10, 15/10, 22/10 — nunca el mismo día de la semana.)
--
-- ⛔ LAS TRES COSAS QUE ESTE MÓDULO NO PUEDE EQUIVOCAR
--
--  1. UNA SALIDA DEL BANCO NO ES UN GASTO. [[norma-salida-de-banco-no-es-gasto]] En Betangar el
--     23,7% de lo que salía no era gasto y la utilidad se veía Bs 55 MM más baja. Acá el egreso
--     va PARTIDO en dos bloques que nunca se suman juntos: gasto y no-gasto (compra de divisas
--     que abona la deuda de los camiones = patrimonio, y traspasos entre cuentas propias, que ni
--     siquiera salen de la empresa y por eso se excluyen enteros).
--
--  2. EL COBRO DE LA ALCALDÍA ESTÁ DOS VECES EN LA TABLA. La app fabrica un movimiento espejo al
--     registrar el abono, con la BASE, y el estado de cuenta trae el NETO real: sumar los dos
--     infla el ingreso un 110%. Se filtra con `btg_es_espejo()`, que ya existía.
--
--  3. UN MOVIMIENTO QUE NO SE PUDO ATRIBUIR SE NOMBRA, NO SE TIRA.
--     [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]] Lo que no se le pudo poner nombre de
--     proveedor sale igual, en su propia lista y con el texto del banco. Un total que cuadra
--     escondiendo lo que no entendió es peor que uno que avisa.
--
-- Todo en DOS monedas. El número que manda es el DÓLAR (el bolívar se devaluó 60% en el período
-- que este informe mira), y cada movimiento se convierte con SU tasa — `btg_tasa_mov()`, que para
-- una compra de divisas usa la tasa PACTADA y nunca el BCV.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. A qué proveedor fue un pago ──────────────────────────────────────────────────────────
-- El banco escribe de dos formas distintas y ninguna trae un id:
--    a) «TELF.:000... CED.:J501030235 CTA.:0105...»   → trae el RIF, no el nombre
--    b) «TRANSFERENCIA A FAVOR DE: TIENDAS DAKA,C.A.» → trae el nombre, no el RIF
-- Por eso se cruza por los dos lados. ⛔ El RIF manda: es exacto. El nombre es el segundo
-- intento y va con candados, porque cruzar por palabras comunes inventa calces
-- [[norma-la-palabra-que-identifica-es-la-rara]]: se le quita el ropaje legal (C.A., S.A.,
-- COMPAÑIA ANONIMA…) a los dos lados y se exige que uno contenga al otro con 8 caracteres
-- mínimos — «SERVICAR C.A» calza con «SERVICAR, C.A.», pero «C.A.» solo no calza con nada.
create or replace function public.btg_nombre_comercial(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(upper(coalesce(p,'')),
             '(,?\s*(C\.?\s?A\.?|S\.?\s?A\.?|S\.?R\.?L\.?|COMPA(N|Ñ)IA\s+ANONIMA|SOCIEDAD\s+ANONIMA))\s*$', '', 'g'),
           '[^A-Z0-9]', '', 'g')
$$;
comment on function public.btg_nombre_comercial(text) is
  'El nombre de una empresa sin su ropaje legal (C.A., S.A., COMPAÑIA ANONIMA) y sin nada que no sea letra o número, para poder comparar cómo lo escribe el banco con cómo está cargado en `proveedores`. ⛔ No sirve para mostrar: sirve para comparar.';

create or replace function public.btg_proveedor_de(p_txt text)
returns text language sql stable as $$
  with t as (select bnc_norm_ident(coalesce(p_txt,'')) ident,
                    -- el nombre que el banco pone después de «A FAVOR DE:» y antes de la cuenta
                    btg_nombre_comercial(
                      substring(coalesce(p_txt,'') from 'A FAVOR DE:\s*([^|]*?)\s*(PARA LA CUENTA|$)')) nom)
  select coalesce(
    -- 1º el RIF: exacto, sin interpretación
    (select p.nombre from proveedores p, t
      where p.rif is not null and length(bnc_norm_ident(p.rif)) >= 8
        and t.ident like '%'||bnc_norm_ident(p.rif)||'%' limit 1),
    -- 2º el nombre, con el mínimo de 8 caracteres que impide el calce por ropaje legal
    (select p.nombre from proveedores p, t
      where length(t.nom) >= 8 and length(btg_nombre_comercial(p.nombre)) >= 8
        and (t.nom like '%'||btg_nombre_comercial(p.nombre)||'%'
          or btg_nombre_comercial(p.nombre) like '%'||t.nom||'%') limit 1))
$$;
comment on function public.btg_proveedor_de(text) is
  'El proveedor al que fue un pago, leído del texto del banco: primero por RIF (exacto) y si no por nombre sin ropaje legal con 8 caracteres mínimos. ⛔ Devuelve NULL cuando no lo puede afirmar — y ese null NO se esconde: el resumen lista aparte lo que no pudo atribuir, con el texto del banco. [[norma-falta-de-dato-no-es-un-dato]]';

-- ── 2. Dónde empieza y termina el ciclo ─────────────────────────────────────────────────────
-- El período NO es la semana del calendario: arranca en el pago de la Alcaldía. Pero «el último
-- pago» a secas deja un agujero: si en la ventana hubo DOS cobros (pasó el 13 y el 15/10, con
-- dos días de diferencia), empezar en el más nuevo haría desaparecer del informe todo lo que
-- pasó entre uno y otro, y nadie se enteraría. [[norma-la-barra-que-no-dice-que-sigue]]
--
-- Por eso el ciclo empieza en el cobro más VIEJO que todavía no se informó, y la corrida queda
-- registrada: así dos informes seguidos no se pisan ni dejan un hueco entre ellos.
create table if not exists public.btg_resumen_socios_corridas (
  id          bigint generated always as identity primary key,
  desde       date not null,
  hasta       date not null,
  enviado_at  timestamptz not null default now(),
  destinos    text[],
  resumen     jsonb
);
comment on table public.btg_resumen_socios_corridas is
  'Cada envío del resumen semanal a los socios, con la ventana que cubrió. Es lo que permite que el informe siguiente empiece donde terminó el anterior, sin pisarse ni dejar un hueco. Sin esta tabla, dos cobros en la misma semana harían desaparecer del informe todo lo que pasó entre ellos.';

create or replace function public.btg_ciclo_alcaldia(p_hasta date default null)
returns table (desde date, hasta date, dias int, cobros int, arranque text)
language sql stable as $$
  with h as (select coalesce(p_hasta, (now() at time zone 'America/Caracas')::date) d),
       ult as (select max(c.hasta) u from btg_resumen_socios_corridas c),
       cobros as (
         select m.fecha::date f from bnc_movimientos m, h
          where m.categoria = 'cobro_alcaldia' and m.tipo = 'credito'
            and not btg_es_espejo(m.id) and m.fecha::date <= h.d),
       -- Los cobros que todavia no entraron en ningun informe. El `>` es estricto: el dia que
       -- cerro el informe anterior ya se conto, y contarlo otra vez duplicaria un ingreso.
       nuevos as (select f from cobros, ult where ult.u is not null and f > ult.u),
       ini as (
         select case
           -- Hay informe anterior: se arranca en el cobro mas VIEJO sin informar, para que lo
           -- que paso entre dos cobros de la misma semana no desaparezca. Si no hubo cobro
           -- nuevo, el ciclo anterior sigue abierto y se continua desde donde cerro.
           when (select u from ult) is not null
             then coalesce((select min(f) from nuevos), (select u + 1 from ult))
           -- PRIMERA corrida: no hay nada que empalmar, asi que se arranca en el ULTIMO cobro.
           -- Tomar el mas viejo aca volcaria toda la historia (220 dias el 28/10/2026) en un
           -- informe que dice ser de la semana.
           else coalesce((select max(f) from cobros), (select d - 6 from h))
         end i)
  select ini.i::date, h.d, ((h.d - ini.i) + 1)::int,
         (select count(*) from cobros where f >= ini.i)::int,
         case when (select u from ult) is null then 'primera'
              when exists (select 1 from nuevos) then 'pago'
              else 'sin_pago' end
    from h, ini;
$$;
comment on function public.btg_ciclo_alcaldia(date) is
  'La ventana que tiene que cubrir el próximo resumen a los socios: arranca en el cobro de la Alcaldía más VIEJO que todavía no se informó y llega hasta hoy. `arranque` dice por qué empieza ahí: `pago` (hubo cobro), `sin_pago` (la Alcaldía no pagó y el ciclo anterior sigue abierto) o `primera` (nunca se corrió). ⛔ Empezar en el cobro más nuevo en vez del más viejo haría desaparecer del informe lo que pasó entre dos cobros de la misma semana.';

-- ── 3. El resumen entero, en una sola llamada ───────────────────────────────────────────────
-- Devuelve jsonb porque lo consumen tres bocas distintas (el informe en PDF, el mensaje corto de
-- WhatsApp y la puerta de datos) y las tres tienen que ver EXACTAMENTE los mismos números: una
-- fuente única, no tres consultas parecidas que se desincronizan. [[norma-fuente-unica-datos]]
create or replace function public.btg_usd_mov(p_monto numeric, p_moneda text, p_fecha date,
                                              p_tasa numeric, p_categoria text)
returns numeric language sql stable as $fn$
  -- Lo que ya está en dólares no se convierte. Lo demás va con la tasa de SU movimiento: para
  -- una compra de divisas es la PACTADA, nunca el BCV (es lo único que siempre tiene una tasa
  -- completamente distinta). Sin tasa NO se inventa una: devuelve null y el informe lo dice.
  select case when upper(coalesce(p_moneda,'VES')) = 'USD' then p_monto
              else p_monto / nullif(btg_tasa_mov(p_fecha, p_tasa, p_categoria), 0) end
$fn$;
comment on function public.btg_usd_mov(numeric,text,date,numeric,text) is
  'Un movimiento del banco en dólares. Lo que ya está en USD no se toca; lo demás usa la tasa de SU movimiento (la pactada si es compra de divisas, el BCV si no). ⛔ Sin tasa devuelve NULL en vez de estimar: un respaldo que rellena inventa un dato.';

create or replace function public.btg_resumen_socios(p_desde date, p_hasta date)
returns jsonb language sql stable as $fn$
with mov as (
  select m.id, m.fecha::date f, m.tipo, m.monto, m.categoria, m.es_gasto, m.factura, m.pata,
         btg_usd_mov(m.monto, m.moneda, m.fecha::date, m.tasa_real, m.categoria) usd,
         btg_tasa_mov(m.fecha::date, m.tasa_real, m.categoria) tasa,
         -- ⛔ El banco mete saltos de línea y tabuladores dentro del concepto. Sin aplastarlos
         --    acá, una sola descripción parte en dos la fila del informe y descuadra la columna
         --    de montos — y además rompe el JSON que consume la pieza que lo imprime.
         trim(regexp_replace(coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,''),
                             '[[:cntrl:]]+', ' ', 'g')) txt
    from bnc_movimientos m
   where m.fecha::date between p_desde and p_hasta
     -- ⛔ El espejo que fabrica la app al registrar el abono trae la BASE y el banco trae el
     --    NETO: sumar los dos infla el cobro de la Alcaldía un 110%.
     and not btg_es_espejo(m.id)
     -- ⛔ Un traspaso entre cuentas propias no entra ni sale de la empresa. Contarlo como
     --    ingreso Y como egreso cuadra el saldo pero infla las dos puntas.
     and m.categoria is distinct from 'traspaso_interno'),

-- ENTRÓ ───────────────────────────────────────────────────────────────────────────────────────
alc as (select * from mov where tipo='credito' and categoria='cobro_alcaldia'),
otros_in as (select * from mov where tipo='credito' and categoria <> 'cobro_alcaldia'),

-- SALIÓ, partido en dos bloques que NUNCA se suman juntos ─────────────────────────────────────
gasto as (select * from mov where tipo='debito' and es_gasto),
nogasto as (select * from mov where tipo='debito' and not es_gasto),

-- Los abonos a la deuda de los camiones. Salen de `deuda_abonos`, que los declara en DÓLARES y
-- los ata al movimiento del banco: es el único sitio donde consta que esos bolívares no fueron a
-- comprar dólares sueltos sino a bajar la deuda de AUTO UNIÓN.
camiones as (
  select n.f, n.monto bs, n.tasa, a.monto usd_abono
    from nogasto n join deuda_abonos a on a.mov_id = n.id),
-- Compra de divisas que NO quedó atada a ningún abono. No se le adivina destino: se lista.
divisas_sueltas as (
  select n.* from nogasto n
   where n.categoria='compra_divisas'
     and not exists (select 1 from deuda_abonos a where a.mov_id = n.id)),

-- A quién se le pagó. Impuestos y comisiones no tienen proveedor (el destinatario es el SENIAT o
-- el propio banco) y la nómina se informa aparte: meterlos acá ensuciaría la lista con filas que
-- nadie puede ir a reclamar.
pagables as (select * from gasto where categoria not in ('nomina','comision_banco','impuestos')),
prov as (
  select coalesce(btg_proveedor_de(txt), '(sin identificar)') nombre,
         btg_proveedor_de(txt) is not null ident,
         count(*) n, sum(monto) bs, sum(usd) usd,
         -- Para los que no se pudieron atribuir, el texto del banco ES la respuesta disponible.
         max(left(txt, 60)) muestra
    from pagables group by 1,2),

-- AVISOS. Lo que el informe tiene que decir aunque no se lo pregunten. ────────────────────────
-- La FIEL CUMPLIMIENTO 10% entra días después del neto. Si una factura cobró su neto y su fiel
-- no aparece, eso es plata de la empresa que está afuera: la pregunta de un socio.
-- ⚠️ EN PLAZO NO ES LO MISMO QUE ATRASADO. La fiel llega días después del neto (el módulo de
-- cobros le da 5 días hábiles). Marcar como pendiente una factura que cobró anteayer haría que
-- el aviso saltara siempre, y un aviso que salta siempre no avisa de nada: a las dos semanas
-- nadie lo lee. Por eso se separan, y solo las atrasadas suman en el número que se destaca.
fiel_falta as (
  select m.factura, min(m.fecha::date) desde_f, sum(m.monto) neto_bs,
         (p_hasta - min(m.fecha::date)) dias,
         -- neto = base x 0,909 y fiel = base x 0,10  =>  fiel ~ neto x 0,11. Es una ESTIMACIÓN
         -- desde el neto que sí entró, y va dicha como tal: el monto exacto lo tiene la factura.
         sum(m.monto) / 0.909 * 0.10 fiel_estimada_bs,
         (p_hasta - min(m.fecha::date)) <= 8 en_plazo
    from bnc_movimientos m
   where m.categoria='cobro_alcaldia' and m.pata='neto' and not btg_es_espejo(m.id)
     and m.fecha::date <= p_hasta and m.fecha::date >= p_hasta - 120
     and not exists (select 1 from bnc_movimientos g
                      where g.factura = m.factura and g.pata='fiel' and not btg_es_espejo(g.id))
   group by m.factura),
sin_tasa as (select count(*) n from mov where usd is null),
sin_clas as (select count(*) n, sum(monto) bs, sum(usd) usd from gasto where categoria='sin_clasificar')

select jsonb_build_object(
 'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', (p_hasta - p_desde) + 1),
 'entro', jsonb_build_object(
    'alcaldia', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'factura', coalesce(factura,'(sin número)'), 'pata', coalesce(pata,'?'),
          'bs', round(monto,2), 'usd', round(usd,2)) order by f) from alc), '[]'::jsonb),
    'alcaldia_bs',  coalesce((select round(sum(monto),2) from alc), 0),
    'alcaldia_usd', coalesce((select round(sum(usd),2)   from alc), 0),
    'otros', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'categoria', categoria, 'bs', round(monto,2), 'usd', round(usd,2),
          'texto', left(txt,60)) order by f) from otros_in), '[]'::jsonb),
    'otros_bs',  coalesce((select round(sum(monto),2) from otros_in), 0),
    'otros_usd', coalesce((select round(sum(usd),2)   from otros_in), 0),
    'total_usd', coalesce((select round(sum(usd),2) from mov where tipo='credito'), 0)),
 'salio_gasto', jsonb_build_object(
    'por_categoria', coalesce((select jsonb_agg(x order by (x->>'usd')::numeric desc) from (
        select jsonb_build_object('categoria', categoria, 'n', count(*),
               'bs', round(sum(monto),2), 'usd', round(sum(usd),2)) x
          from gasto group by categoria) s), '[]'::jsonb),
    'total_bs',  coalesce((select round(sum(monto),2) from gasto), 0),
    'total_usd', coalesce((select round(sum(usd),2)   from gasto), 0)),
 'salio_no_gasto', jsonb_build_object(
    'camiones', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'bs', round(bs,2), 'tasa', round(tasa,4), 'usd', round(usd_abono,2)) order by f)
        from camiones), '[]'::jsonb),
    'camiones_usd', coalesce((select round(sum(usd_abono),2) from camiones), 0),
    'camiones_bs',  coalesce((select round(sum(bs),2) from camiones), 0),
    'divisas_sin_destino', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'bs', round(monto,2), 'usd', round(usd,2), 'texto', left(txt,60)) order by f)
        from divisas_sueltas), '[]'::jsonb),
    'total_bs',  coalesce((select round(sum(monto),2) from nogasto), 0),
    'total_usd', coalesce((select round(sum(usd),2)   from nogasto), 0)),
 'proveedores', coalesce((select jsonb_agg(jsonb_build_object(
      'nombre', nombre, 'identificado', ident, 'n', n,
      'bs', round(bs,2), 'usd', round(usd,2), 'muestra', muestra) order by usd desc nulls last)
    from prov), '[]'::jsonb),
 'avisos', jsonb_build_object(
    'fiel_sin_entrar', coalesce((select jsonb_agg(jsonb_build_object(
          'factura', factura, 'desde', desde_f, 'dias', dias, 'en_plazo', en_plazo,
          'neto_bs', round(neto_bs,2), 'fiel_estimada_bs', round(fiel_estimada_bs,2))
          order by desde_f) from fiel_falta), '[]'::jsonb),
    'fiel_atrasadas', (select count(*) from fiel_falta where not en_plazo),
    'fiel_atrasada_bs', coalesce((select round(sum(fiel_estimada_bs),2) from fiel_falta
                                   where not en_plazo), 0),
    'sin_clasificar', (select jsonb_build_object('n', coalesce(n,0),
          'bs', round(coalesce(bs,0),2), 'usd', round(coalesce(usd,0),2)) from sin_clas),
    'movimientos_sin_tasa', (select n from sin_tasa)),
 'saldo_usd', round(coalesce((select sum(usd) from mov where tipo='credito'),0)
                  - coalesce((select sum(usd) from mov where tipo='debito'),0), 2));
$fn$;
comment on function public.btg_resumen_socios(date,date) is
  'El resumen financiero del ciclo para los socios: qué entró (cobros de la Alcaldía factura por factura, y otros ingresos), qué salió partido en GASTO y NO-GASTO (la compra de divisas que abona los camiones no es gasto), cuánto se le pagó a cada proveedor, y los avisos —la fiel 10% que no ha entrado, lo que quedó sin clasificar y los movimientos sin tasa—. Todo en bolívares y en dólares. ⛔ Excluye el movimiento espejo y los traspasos entre cuentas propias: sumarlos infla las dos puntas.';
