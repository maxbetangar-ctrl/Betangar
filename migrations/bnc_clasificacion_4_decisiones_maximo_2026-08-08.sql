-- ============================================================================
-- Betangar · DECISIONES DE MÁXIMO sobre la clasificación del estado de cuenta
-- 2026-08-08. Todas quedan marcadas `manual:` — NINGUNA regla automática las pisa.
--
-- Estas no se deducen de los datos: las dictó él mirando los soportes. Si algún
-- día una regla de texto "corrige" alguna de estas, la está rompiendo.
-- ============================================================================

-- ── RICARDO DEVIS: asignación tipo B SIEMPRE ────────────────────────────────
-- «no le preguntes si fue mal escrito, es una realidad: a él es asignación al
--  tipo B, fue error de tipeo, estoy seguro». Sus 2 conceptos que dicen
-- «CAMBIO DE MONEDA» son un error de la administración, NO son divisas.
update bnc_movimientos m
   set categoria='asignacion_1b', es_gasto=true,
       clasificado_por='manual:maximo_devis_es_asignacion_tipo_b', clasificado_at=now()
  from bnc_entidades e
 where m.entidad_id=e.id and e.nombre='RICARDO DEVIS' and m.categoria <> 'comision_banco';

-- ── ATLAS: «aporte a socio» fue compra de dólares, pero SOLO al principio ───
-- «ese aporte a socio atlas fue compra de dólares también» · «PERO no siempre
--  atlas es compra de dólares, eso fue al principio, ya atlas no es para eso».
-- ⛔ Por eso NO se crea una regla de concepto: se fija ESTE movimiento y nada más.
update bnc_movimientos
   set categoria='compra_divisas', es_gasto=false,
       clasificado_por='manual:maximo_atlas_aporte_socio_es_divisas', clasificado_at=now()
 where coalesce(detalle->>'concepto_declarado', descripcion) ~* 'aporte a socio';

-- ── GALAC: es COMPRA DE SOFTWARE ───────────────────────────────────────────
-- «el software galac es bueno que lo pongas como eso: compra software galac».
-- ⚠️ Su concepto dice «NOMINA» (es el MÓDULO de nómina del software): una regla
-- de texto lo confunde con sueldos.
update bnc_movimientos
   set categoria='compra_software', es_gasto=true,
       entidad_id=(select id from bnc_entidades where nombre like 'GALAC%'),
       clasificado_por='manual:maximo_compra_software_galac', clasificado_at=now()
 where coalesce(detalle->>'concepto_declarado', descripcion) ~* 'galac';

-- ...pero los ALMUERZOS que solo mencionan Galac (fueron durante el curso) NO
-- son compra de software.
update bnc_movimientos
   set categoria='bienestar_personal', entidad_id=null,
       clasificado_por='concepto:bienestar', clasificado_at=now()
 where categoria='compra_software'
   and coalesce(detalle->>'concepto_declarado','') ~* 'almuerzo|pollo loko|comida|refrigerio';

-- ── MÁXIMO BETANCOURT: a su cuenta van SEIS cosas, no solo el 7,5% ─────────
-- «no todo lo que va a mi cuenta es el 7,5%; ahí también me pasan mi nómina,
--  que son 3.000$ a BCV mensual; a veces prestaba dinero y reembolso como caja
--  chica». Verificado: mayo 4 pagos = US$ 2.994,55 · junio 4 = US$ 3.000,01.
update bnc_movimientos m
   set categoria=v.cat, es_gasto=v.gasto,
       clasificado_por='concepto:maximo_'||v.regla, clasificado_at=now()
  from bnc_entidades e,
       (values ('duplicado', true,'duplicado','pago duplicado'),
               ('nomina',    true,'nomina',   'n[oó]mina'),
               ('pago_socio',true,'socio',    'pago a socio *7|fiel cump|reparto de dividendo'),
               ('caja_chica',true,'caja',     'caja chica'),
               ('reembolso', true,'reembolso','reembolso|reemb\.|devoluci|compras en eeuu|equipos importados|starlink|antena|ecoflow|zoom|cisterna|grasa|internet'),
               ('prestamo', false,'prestamo', 'prestamo|préstamo'),
               ('combustible',true,'combustible','gasoil|litros'),
               ('dotacion', true,'almuerzos', 'almuerzo|sillas')
       ) as v(cat, gasto, regla, patron)
 where m.entidad_id=e.id and e.nombre='MÁXIMO BETANCOURT' and m.tipo='debito'
   and m.categoria <> 'comision_banco'
   and coalesce(m.detalle->>'concepto_declarado', m.descripcion) ~* v.patron;

-- Su NÓMINA semanal (US$ 750) que NO trae su cédula en el texto. La serie SEM
-- 4→8 es continua y él confirmó: «todas las semanas me las han pagado».
update bnc_movimientos m
   set entidad_id=(select id from bnc_entidades where nombre='MÁXIMO BETANCOURT'),
       clasificado_por='manual:maximo_confirma_serie_semanal', clasificado_at=now()
  from (select bcv_dolar, fecha from tasas_diarias) t
 where m.tipo='debito' and m.categoria='nomina' and m.entidad_id is null
   and t.fecha=(select max(t2.fecha) from tasas_diarias t2 where t2.fecha <= m.fecha::date and t2.bcv_dolar>0)
   and m.monto / t.bcv_dolar between 700 and 800;

-- Su CAJA CHICA sale por una cuenta del BANCO PROVINCIAL (0108…), distinta a la
-- del BNC (0191…). «esa cédula es la mía, solo que al Banco Provincial; al final
--  definí que era mejor usar una cuenta distinta a la del BNC para la caja chica».
insert into bnc_entidad_ident (entidad_id, tipo, ident)
select e.id, v.tipo, bnc_norm_ident(v.ident)
from bnc_entidades e, (values ('cedula','V017370238'),
                              ('cuenta','01080059510100388938')) as v(tipo, ident)
where e.nombre='MÁXIMO BETANCOURT'
on conflict (tipo, ident) do nothing;

-- ── EL PRÉSTAMO CASTILLO: CONGELADO, no se clasifica ───────────────────────
-- «este tengo que explicártelo bien pero después». Mezcla un préstamo, un
-- apellido que apunta a varias personas y un reembolso AGRUPADO (salieron 3
-- débitos de Bs 646.800 y volvió UN crédito de Bs 1.293.627,99).
-- ⛔ Queda marcado para que ninguna regla se lo lleve por delante.
update bnc_movimientos
   set categoria='⏳pendiente_explicar', es_gasto=true,
       clasificado_por='manual:maximo_lo_va_a_explicar', clasificado_at=now()
 where coalesce(detalle->>'concepto_declarado', descripcion) ~* 'préstamo castillo|prestamo castillo';
