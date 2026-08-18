-- ============================================================================
-- LA FOTO DE LA FACTURA, EN EL ACTO DE FACTURAR-Y-PAGAR  ·  18/08/2026
--
-- Pedido de Máximo: «si ya estamos metiendo foto de la factura… pudiera haber la
-- opción de ver foto de la factura pegada al gasto, ahí en la línea».
--
-- ⚠️ LA PREMISA QUE HABÍA QUE ENTENDER PRIMERO, y que me corrigió Máximo:
--    «en cuentas por pagar NO hay factura, aquí se factura es cuando se paga…
--     justo antes de pagar, porque el diferencial cambiario no deja facturar y
--     que después se pague… la CxP se mantiene en DÓLARES, y cuando se define
--     que se va a pagar se le pide a la empresa que facture, y justo después se
--     transfiere ese mismo día.»
--
--    Eso NO es un detalle de forma, cambia dónde va la columna. Y desarma un
--    "hallazgo" que yo había escrito antes de preguntar: había medido que las 12
--    CxP pendientes (US$ 1.789,35) no tenían NI UNA factura y lo reporté como un
--    hueco de control. No lo es. Los datos, leídos con la premisa correcta, dicen
--    lo contrario:
--
--        pendiente → 12 filas · 0 con factura · 0 con pago
--        pagada    → 10 filas · 10 con factura · 10 con pago
--
--    La correlación es PERFECTA: factura ⟺ pago. Que una CxP pendiente no tenga
--    factura no es un descuido, es que la factura todavía no existe.
--    [[norma-auditoria-precondicion-antes-de-acusar]]
--
-- ⛔ POR ESO LA FOTO VA EN `cxp_facturas`, NO EN `cxp`. `cxp` es la deuda en
--    dólares y nace sin documento, a propósito. `cxp_facturas` es el documento,
--    y nace en el mismo acto en que se paga (`guardarFactura()` con `pagarYa`).
--    Pedir la foto ahí es pedirla en el único momento en que existe.
--
-- ⛔ Y TAMPOCO EN LA LÍNEA DEL BANCO. Un pago cubre varias facturas y una factura
--    cubre varias órdenes [[norma-factura-proveedor-cubre-varias-ordenes]]. Si la
--    foto se pega al movimiento bancario, el mismo documento se sube dos y tres
--    veces y después nadie sabe cuál es el bueno. Se pega UNA vez, en la factura,
--    y las demás pantallas la muestran enlazada. [[norma-fuente-unica-datos]]
--
-- 🔐 BUCKET PRIVADO, y esto no es opcional. Las fotos de la operación viven en
--    `entregas`, que es PÚBLICO a propósito (la evidencia la ve el cliente sin
--    cuenta). Una factura trae RIF, montos y número de control fiscal: no puede
--    abrirse con la sola URL [[norma-storage-publico-y-quien-lee]]. Va en
--    `facturas`, privado, y se ve con URL firmada — la pieza ya existe
--    (`verFotoPrivada` / `_urlFirmada` / `_firmarLote`).
-- ============================================================================

-- ── 1. El bucket, PRIVADO ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,                       -- si alguien lo abrió, se vuelve a cerrar
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- Solo quien tiene sesión. `anon` no toca nada acá: una factura no es evidencia pública.
drop policy if exists fact_leer   on storage.objects;
drop policy if exists fact_subir  on storage.objects;
drop policy if exists fact_actual on storage.objects;
create policy fact_leer   on storage.objects for select
  to authenticated using (bucket_id = 'facturas');
create policy fact_subir  on storage.objects for insert
  to authenticated with check (bucket_id = 'facturas');
create policy fact_actual on storage.objects for update
  to authenticated using (bucket_id = 'facturas') with check (bucket_id = 'facturas');
-- Borrar NO se concede: una factura que respalda un pago no se quita por pantalla.

-- ── 2. Dónde vive la ruta ────────────────────────────────────────────────────
alter table cxp_facturas add column if not exists foto text;

comment on column cxp_facturas.foto is
  'RUTA en el bucket PRIVADO `facturas` (nunca una URL firmada: esas vencen). Foto o PDF '
  'del documento que emitió el proveedor. Se ve con verFotoPrivada(''facturas'', ruta). '
  '⛔ NO va a `entregas`: ese bucket es público y una factura trae RIF, montos y nº de '
  'control fiscal. Se pide en el acto de facturar-y-pagar, que es cuando el documento '
  'existe: la CxP se lleva en dólares y sin factura hasta que se decide pagar.';

-- ── 3. La vista que contesta «¿qué se pagó sin documento a la vista?» ────────
-- ⚠️ Mira las facturas EMITIDAS, no las CxP pendientes. Una CxP sin factura no es un
--    faltante —todavía no se pagó— y contarla como tal sería inventar un problema.
--    Lo que sí es un hueco real: una factura que ya se emitió y se pagó, y de la que
--    no quedó el papel.
create or replace view v_facturas_sin_foto as
select
  f.id, f.fecha, f.prov_nombre, f.nro_factura, f.num_control,
  f.total_bs, f.neto_bs, f.cxp_id,
  (select c.descripcion from cxp c where c.id = f.cxp_id) as concepto_deuda
from cxp_facturas f
where coalesce(f.foto, '') = '';

comment on view v_facturas_sin_foto is
  'Facturas de proveedor ya emitidas (y por tanto pagadas: acá se factura al pagar) de las '
  'que no quedó la imagen del documento. Es el hueco real de respaldo. ⛔ NO se miran las '
  'CxP pendientes: esas no tienen factura porque todavía no se pagaron, y contarlas sería '
  'acusar de falta algo que no debe existir todavía.';
