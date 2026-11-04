-- =============================================================================
-- EL INFORME NOMBRA LO QUE LA BASE YA SABE — 2026-11-04
--
-- Maximo, 04/11/2026: «dices que entro de la alcaldia factura sin numero viernes
-- 30/10/2026; tu sabes que eso no es factura, eso es devolucion de fiel cumplimiento
-- de varias facturas, deberia decir eso si tu ya sabes que es eso».
--
-- Tenia razon y es peor de lo que parece: HOY MISMO se escribieron en
-- `cobros_factura` las siete filas que dicen que ese deposito (bnc_85217331,
-- Bs 14.555.054,23) es la fiel del 10% de las facturas 000646 a la 000652. El dato
-- estaba cargado, y el informe que salio a los socios seguia diciendo
-- «Alcaldia - factura (sin numero) (?)». Estar cargado no es saberlo.
--
-- El movimiento del banco no tiene `factura` ni `pata` porque agrupa SIETE: ese
-- modelo no entra en dos columnas. Quien lo sabe es `cobros_factura`, y se ata por
-- la REFERENCIA del banco, que es identica en el movimiento y en las siete filas.
-- =============================================================================

create or replace function public.btg_resumen_socios(p_desde date, p_hasta date)
returns jsonb language sql stable as $fn$
with par_divisas as (
  -- ⛔ UNA COMPRA DE DIVISAS TIENE DOS PATAS Y NO SE PUEDE CONTAR UNA SOLA.
  --    El abono en dolares entra a una cuenta NUESTRA y los bolivares salen de otra
  --    cuenta NUESTRA: no entro ni salio plata de la empresa, es la misma plata en
  --    otra moneda. Las dos patas se van del informe juntas, o ninguna.
  --
  -- 🔴 04/11/2026, lo que obligo a escribir esto. El 30/10 el banco vendio
  --    US$ 12.000: debito Bs 10.671.063,60 (bnc_102516294) y abono US$ 12.000
  --    (bnc_102516299), a 889,2553 = el BCV del dia. La pata en bolivares quedo
  --    clasificada `traspaso_interno` —que este informe descarta entero— y el abono
  --    en dolares si se conto. El ciclo le informo a los socios **15.191,35** cuando
  --    eran **3.191,35**, y un socio sumo ademas los 7.100 y entendio 22.291.
  --
  -- ⛔ EL EMPAREJAMIENTO NO MIRA LA CATEGORIA. Justamente la categoria fue lo que
  --    fallo: si el arreglo dependiera de que este bien clasificado, el mismo error
  --    vuelve el dia que el clasificador se equivoque otra vez. Empareja por IMPORTE
  --    y DIA — monto del debito = dolares x tasa del abono, +-2 Bs — que es lo que
  --    no depende de nadie. [[norma-arreglar-el-mecanismo-no-el-caso]]
  select c.id credito_id, d.id debito_id, c.monto usd, c.fecha::date f,
         c.tasa_real tasa
    from bnc_movimientos c
    join lateral (
      select dd.id, dd.monto
        from bnc_movimientos dd
       where dd.tipo = 'debito'
         and dd.fecha::date = c.fecha::date
         and abs(dd.monto - c.monto * c.tasa_real) <= 2
       order by abs(dd.monto - c.monto * c.tasa_real)
       limit 1) d on true
   where c.tipo = 'credito'
     and c.categoria = 'divisas_recibidas'
     and c.tasa_real is not null
),
abono_sin_pata as (
  -- Un abono de divisas SIN pata tampoco se cuenta — pero NO en silencio: se dice.
  -- Un filtro nuestro que descarta se ve igual que un dato que no llego.
  -- [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
  select c.id, c.fecha::date f, c.monto usd,
         trim(regexp_replace(coalesce(c.descripcion,'') || ' ' || coalesce(c.concepto_banco,''),
                             '[[:cntrl:]]+', ' ', 'g')) txt
    from bnc_movimientos c
   where c.tipo = 'credito'
     and c.categoria = 'divisas_recibidas'
     and c.fecha::date between p_desde and p_hasta
     and not exists (select 1 from par_divisas p where p.credito_id = c.id)
),
compradas as (
  select coalesce(sum(p.usd), 0) usd, count(*) n
    from par_divisas p
   where p.f between p_desde and p_hasta
),
mov as (
  select m.id, m.fecha::date f, m.tipo, m.monto, m.categoria, m.es_gasto, m.factura, m.pata,
         m.referencia,
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
     and m.categoria is distinct from 'traspaso_interno'
     -- Las DOS patas de una compra de divisas, fuera: ni entra ni sale.
     and m.id not in (select credito_id from par_divisas
                      union all select debito_id from par_divisas)
     -- Y el abono suelto tampoco suma; se reporta en avisos.
     and m.id not in (select id from abono_sin_pata)),

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
     -- 04/11/2026. Un deposito puede traer VARIAS fieles juntas, y entonces no hay
     -- una fila de banco por factura que marcar: el 30/10 llegaron siete en una
     -- (bnc_85217331). Quien sabe que pata de que factura se cobro es
     -- `cobros_factura`, que para eso existe; leer solo `bnc_movimientos` era la
     -- segunda lista. [[norma-dos-listas-a-mano-se-desincronizan]]
     and not exists (select 1 from cobros_factura c
                      where c.fact = m.factura and c.pata = 'fiel')
   group by m.factura),
sin_tasa as (select count(*) n from mov where usd is null),
sin_clas as (select count(*) n, sum(monto) bs, sum(usd) usd from gasto where categoria='sin_clasificar')

select jsonb_build_object(
 'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', (p_hasta - p_desde) + 1),
 'entro', jsonb_build_object(
    -- ⛔ UN DEPOSITO QUE TRAE LA FIEL DE VARIAS FACTURAS NO ES «UNA FACTURA SIN NUMERO».
    --    04/11/2026: el informe le decia a los socios «Alcaldia - factura (sin numero) (?)»
    --    sobre el pago del 30/10, cuando `cobros_factura` YA tenia las siete filas que
    --    dicen que era la devolucion del 10% de las facturas 000646 a la 000652. El dato
    --    estaba cargado y el informe no lo miraba: estar cargado no es saberlo.
    --    Se ata por REFERENCIA del banco, que es la misma en el movimiento y en las filas.
    --    [[norma-estar-cargado-no-es-saberlo]] · [[norma-fuente-unica-datos]]
    'alcaldia', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', a.f, 'factura', coalesce(a.factura,'(sin número)'), 'pata', coalesce(a.pata,'?'),
          'detalle', (select jsonb_build_object('pata', min(c.pata), 'n', count(*),
                             'desde', min(c.fact), 'hasta', max(c.fact))
                        from cobros_factura c
                       where a.factura is null
                         and nullif(btrim(coalesce(a.referencia,'')),'') is not null
                         and c.referencia = a.referencia
                      having count(*) > 0),
          'bs', round(a.monto,2), 'usd', round(a.usd,2)) order by a.f) from alc a), '[]'::jsonb),
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
    'movimientos_sin_tasa', (select n from sin_tasa),
    -- Un abono de divisas cuya pata en bolivares no aparece. No se conto: se avisa.
    'divisas_sin_pata', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'usd', round(usd,2), 'texto', left(txt, 70)) order by f)
       from abono_sin_pata), '[]'::jsonb)),
 -- Informativo, FUERA del saldo: los dolares que compramos en el periodo. No son
 -- ingreso ni gasto, son los mismos bolivares en otra moneda — pero el socio pidio
 -- expresamente verlos («se compraron tantos dolares»).
 'divisas_compradas', (select jsonb_build_object('usd', round(usd,2), 'operaciones', n)
                         from compradas),
 'saldo_usd', round(coalesce((select sum(usd) from mov where tipo='credito'),0)
                  - coalesce((select sum(usd) from mov where tipo='debito'),0), 2));
$fn$;
comment on function public.btg_resumen_socios(date,date) is
  'El resumen financiero del ciclo para los socios: qué entró (cobros de la Alcaldía factura por factura, y otros ingresos), qué salió partido en GASTO y NO-GASTO (la compra de divisas que abona los camiones no es gasto), cuánto se le pagó a cada proveedor, y los avisos —la fiel 10% que no ha entrado, lo que quedó sin clasificar y los movimientos sin tasa—. Todo en bolívares y en dólares. ⛔ Excluye el movimiento espejo y los traspasos entre cuentas propias: sumarlos infla las dos puntas.';



