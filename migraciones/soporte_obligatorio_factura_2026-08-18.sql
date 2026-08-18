-- ============================================================================
-- EL SOPORTE ES OBLIGATORIO PARA PAGAR — y la salida deja rastro  · 18/08/2026
--
-- Máximo: «si no hay factura debe haber algún soporte, algo que suban. Los únicos
-- que no exigen factura, nota de crédito o soporte son los de la NÓMINA. O sea
-- que sea obligatoria el soporte de foto al cerrar una factura para pagar, pero
-- un botoncito que lo logre inhabilitar pidiéndole una explicación de por qué no
-- tiene soporte, para que en el caso de nómina pueda avanzar.»
--
-- ⚠️ Yo le había recomendado lo contrario —dejarlo opcional— por miedo a que la
--    oficina marcara todo "sin soporte" para poder trabajar y el indicador se
--    volviera mentira. Su diseño resuelve justo eso: la salida existe, pero
--    EXIGE ESCRIBIR EL MOTIVO. Un motivo escrito no se pone por costumbre, y si
--    se pone, queda con nombre y fecha para que alguien lo lea después.
--
-- Por eso el motivo es TEXTO y no una casilla: una casilla se tilda sin pensar.
-- ============================================================================

alter table cxp_facturas add column if not exists sin_soporte_motivo text;

comment on column cxp_facturas.sin_soporte_motivo is
  'Por qué esta factura se cerró SIN documento. Se pide por pantalla y no se puede pagar '
  'sin foto ni sin este texto. El caso previsto es la NÓMINA, que no lleva factura ni nota '
  'de crédito. ⛔ No es una casilla a propósito: una casilla se tilda sin pensar, un motivo '
  'escrito queda para que alguien lo lea.';

-- La vista cambia de pregunta: ya no es «cuáles no tienen foto» (ahora eso no puede pasar
-- sin querer), sino «cuáles se pagaron sin documento Y qué explicación se dio».
create or replace view v_facturas_sin_foto as
select
  f.id, f.fecha, f.prov_nombre, f.nro_factura, f.num_control,
  f.total_bs, f.neto_bs, f.cxp_id,
  (select c.descripcion from cxp c where c.id = f.cxp_id) as concepto_deuda,
  -- ⚠️ Las dos nuevas van AL FINAL a propósito: `create or replace view` no deja renombrar ni
  --    reordenar columnas existentes, y forzar un DROP de la vista para acomodarlas habría hecho
  --    falta pasar por el candado de borrado por una cuestión estética.
  f.sin_soporte_motivo,
  (coalesce(f.sin_soporte_motivo,'') = '') as sin_explicacion
from cxp_facturas f
where coalesce(f.foto, '') = '';

comment on view v_facturas_sin_foto is
  'Facturas cerradas SIN documento. `sin_explicacion` = true son las viejas, anteriores al '
  '18/08/2026, cuando todavía no se pedía nada: no son un incumplimiento de nadie. Las nuevas '
  'llevan siempre motivo escrito. ⛔ No se miran las CxP pendientes: esas no tienen factura '
  'porque todavía no se pagaron.';
