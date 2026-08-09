-- ============================================================================
-- Betangar · GUARDAR TAMBIÉN LO QUE DICE EL BANCO, no solo lo que anotó la oficina
-- 2026-08-09.
--
-- ⛔ EL CASO QUE LO DESTAPÓ
-- El fiel cumplimiento de la factura 000627 (29/04, Bs 822.174,91) y el de la
-- 000630 (10/06, Bs 1.445.810,16) estaban guardados y aun así el sistema no
-- podía saber de quién eran. Los dos textos, del MISMO movimiento:
--
--   guardado (Excel de Aurelys):  «Credito Inmediato Recibido - ref: 9491319325335 — INGRESO»
--   el banco (API):               «fc segun factura EMISOR : INSTITUTO MUNICIPAL DEL ASEO U»
--
-- El del Excel NO nombra a la Alcaldía. La clasificación busca el RIF
-- G-200060204 dentro del texto, y ahí no está: el cobro quedaba como
-- `otro_ingreso` y su factura, sin cobrar.
--
-- ⚠️ ESTO CORRIGE UNA DECISIÓN DE ESTA MISMA MAÑANA. Al enchufar el traído se
-- eligió `ignoreDuplicates` para NO pisar la descripción guardada, con el
-- argumento de que el Excel trae la clasificación que escribió la
-- administración y la API no. Es cierto — pero al revés TAMBIÉN: hay
-- movimientos donde el Excel dice MENOS que el banco.
--
-- La respuesta no es elegir una fuente: es guardar las dos. `descripcion`
-- sigue siendo lo que anotó la oficina (y nadie la pisa); `concepto_banco` es
-- lo que dijo el banco. La clasificación mira las dos.
-- [[norma-fuente-unica-datos]] no dice «una sola fuente para todo», dice «un
-- solo lugar para CADA dato». Son dos datos distintos.
-- ============================================================================

alter table bnc_movimientos add column if not exists concepto_banco text;

comment on column bnc_movimientos.concepto_banco is
  'El Concept que devuelve la API del BNC, tal cual. NO se pisa con `descripcion`: son dos datos distintos. El Excel de la oficina agrega la clasificación («— PAGO DE NÓMINA»); el banco agrega el beneficiario y el emisor («fc segun factura EMISOR : INSTITUTO MUNICIPAL DEL ASEO U»). Cada uno sabe algo que el otro no.';

-- ---------------------------------------------------------------------------
-- La clasificación pasa a mirar LOS DOS TEXTOS. Una función para no repetir el
-- `coalesce` en cada regla y que no se olvide en la próxima que se agregue.
-- ---------------------------------------------------------------------------
create or replace function bnc_texto(m bnc_movimientos)
returns text language sql immutable as $$
  select coalesce(m.descripcion,'') || ' ⟪banco⟫ ' || coalesce(m.concepto_banco,'')
$$;

comment on function bnc_texto is
  'Todo lo que se sabe por escrito de un movimiento: lo que anotó la oficina Y lo que dijo el banco. Buscar en uno solo deja cobros sin dueño.';
