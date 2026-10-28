-- ════════════════════════════════════════════════════════════════════════════════════════════
-- EL RESUMEN DE LOS SOCIOS SE CIERRA — Betangar · 28/10/2026
--
-- ⛔ LO QUE ESTABA MAL, Y LO HICE YO HOY. `btg_resumen_socios()` nació con `EXECUTE` para
--    `PUBLIC`, que es lo que le pasa a TODA función nueva en Postgres si nadie se lo quita.
--    PUBLIC incluye `anon`, el rol de la clave que viaja en el navegador y está en el HTML.
--    O sea: cualquiera con esa clave —que es pública por diseño— podía pedir el estado de cuenta
--    entero del banco, factura por factura y proveedor por proveedor, sin sesión.
--    [[norma-toda-funcion-nace-abierta-a-public]]
--
-- 📌 DOS CANDADOS, NO UNO, porque protegen de cosas distintas:
--    1. El GRANT saca a `anon` del camino: sin sesión no se llega ni a intentarlo.
--    2. El gate de ROL adentro saca al resto: un chofer tiene sesión y es `authenticated`, y sin
--       esto podría leer la nómina y los pagos a proveedores de toda la empresa.
--    Con solo el grant, cualquier empleado con usuario lo vería. Con solo el gate, el candado
--    viviría dentro de una función que anon igual puede llamar. [[norma-seguridad-dos-niveles]]
--
-- ⛔ EL GATE LEVANTA, NO DEVUELVE FALSO. `btg_ve_financiero_o_falla()` existe justamente por eso:
--    un `false` acá se convertiría en un informe VACÍO, y un informe vacío se lee como «esta
--    semana no se movió nada», que es una mentira redonda. [[norma-falta-de-dato-no-es-un-dato]]
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. El gate adentro de la función que devuelve la plata ──────────────────────────────────
-- Se re-crea entera con una sola línea nueva: el `guard` en el FROM final. Va ahí y no en un
-- `where` porque un `where` que no se cumple devuelve CERO FILAS en silencio; un cross join
-- contra una función que levanta, corta la consulta con un error que se lee.
create or replace function public.btg_resumen_socios(p_desde date, p_hasta date)
returns jsonb language sql stable as $fn$
with guard as (select btg_ve_financiero_o_falla() ok),
mov as (
  select m.id, m.fecha::date f, m.tipo, m.monto, m.categoria, m.es_gasto, m.factura, m.pata,
         btg_usd_mov(m.monto, m.moneda, m.fecha::date, m.tasa_real, m.categoria) usd,
         btg_tasa_mov(m.fecha::date, m.tasa_real, m.categoria) tasa,
         -- ⛔ El banco mete saltos de línea y tabuladores dentro del concepto. Sin aplastarlos
         --    acá, una sola descripción parte en dos la fila del informe y descuadra la columna
         --    de montos — y además rompe el JSON que consume la pieza que lo imprime.
         trim(regexp_replace(coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,''),
                             '[[:cntrl:]]+', ' ', 'g')) txt
    from bnc_movimientos m, guard
   where m.fecha::date between p_desde and p_hasta
     -- ⛔ El espejo que fabrica la app al registrar el abono trae la BASE y el banco trae el
     --    NETO: sumar los dos infla el cobro de la Alcaldía un 110%.
     and not btg_es_espejo(m.id)
     -- ⛔ Un traspaso entre cuentas propias no entra ni sale de la empresa. Contarlo como
     --    ingreso Y como egreso cuadra el saldo pero infla las dos puntas.
     and m.categoria is distinct from 'traspaso_interno'),

alc as (select * from mov where tipo='credito' and categoria='cobro_alcaldia'),
otros_in as (select * from mov where tipo='credito' and categoria <> 'cobro_alcaldia'),
gasto as (select * from mov where tipo='debito' and es_gasto),
nogasto as (select * from mov where tipo='debito' and not es_gasto),

camiones as (
  select n.f, n.monto bs, n.tasa, a.monto usd_abono
    from nogasto n join deuda_abonos a on a.mov_id = n.id),
divisas_sueltas as (
  select n.* from nogasto n
   where n.categoria='compra_divisas'
     and not exists (select 1 from deuda_abonos a where a.mov_id = n.id)),

pagables as (select * from gasto where categoria not in ('nomina','comision_banco','impuestos')),
prov as (
  select coalesce(btg_proveedor_de(txt), '(sin identificar)') nombre,
         btg_proveedor_de(txt) is not null ident,
         count(*) n, sum(monto) bs, sum(usd) usd,
         max(left(txt, 60)) muestra
    from pagables group by 1,2),

fiel_falta as (
  select m.factura, min(m.fecha::date) desde_f, sum(m.monto) neto_bs,
         (p_hasta - min(m.fecha::date)) dias,
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
                  - coalesce((select sum(usd) from mov where tipo='debito'),0), 2))
  from guard;
$fn$;
comment on function public.btg_resumen_socios(date,date) is
  'El resumen financiero del ciclo para los socios: qué entró (cobros de la Alcaldía factura por factura, y otros ingresos), qué salió partido en GASTO y NO-GASTO (la compra de divisas que abona los camiones no es gasto), cuánto se le pagó a cada proveedor, y los avisos —la fiel 10% que no ha entrado, lo que quedó sin clasificar y los movimientos sin tasa—. Todo en bolívares y en dólares. ⛔ Exige poder ver el financiero: LEVANTA si no, porque un informe vacío se leería como «no se movió nada». ⛔ Excluye el movimiento espejo y los traspasos entre cuentas propias: sumarlos infla las dos puntas.';

-- ── 2. El grant: fuera `anon` ───────────────────────────────────────────────────────────────
-- A `anon` se le quita por PUBLIC (que es de donde lo tenía) y también por su nombre, por si
-- alguna vez se lo dieron aparte. Quitar solo uno de los dos deja la puerta abierta y el
-- `revoke` igual contesta OK. [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
revoke execute on function public.btg_resumen_socios(date,date)  from public, anon;
revoke execute on function public.btg_ciclo_alcaldia(date)       from public, anon;
revoke execute on function public.btg_proveedor_de(text)         from public, anon;
revoke execute on function public.btg_usd_mov(numeric,text,date,numeric,text) from public, anon;

grant execute on function public.btg_resumen_socios(date,date)  to authenticated, service_role;
grant execute on function public.btg_ciclo_alcaldia(date)       to authenticated, service_role;
grant execute on function public.btg_proveedor_de(text)         to authenticated, service_role;
grant execute on function public.btg_usd_mov(numeric,text,date,numeric,text) to authenticated, service_role;

-- ── 3. El registro de corridas: que la pantalla lo pueda leer, y nadie escribirlo ───────────
-- Es la prueba de que el informe salió. Lo escribe la edge function con `service_role`, que se
-- salta RLS; la pantalla solo lo LEE, y solo quien puede ver el financiero.
alter table public.btg_resumen_socios_corridas enable row level security;
revoke all on public.btg_resumen_socios_corridas from public, anon;
grant select on public.btg_resumen_socios_corridas to authenticated;

drop policy if exists corridas_lee_financiero on public.btg_resumen_socios_corridas;
create policy corridas_lee_financiero on public.btg_resumen_socios_corridas
  for select to authenticated using (btg_ve_financiero());
-- ⛔ No se crea ninguna policy de INSERT/UPDATE/DELETE a propósito: con RLS encendida y sin
--    policy, nadie con sesión puede tocar esta tabla. Que una corrida se pueda inventar o borrar
--    desde el navegador convertiría en mentira la única prueba de que el informe salió.
