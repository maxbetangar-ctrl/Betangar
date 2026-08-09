-- ============================================================================
-- Betangar · quién es quién en el estado de cuenta
-- La categoría es el DEFAULT de la entidad. Varias reciben más de una cosa
-- (Auto Unión: divisas y reparación · Comercializadora Paz Jiménez: combustible
-- y alquiler, porque los dueños de El Palotal son los del galpón alquilado):
-- a esas las afina la regla por concepto, no la entidad.
-- ============================================================================

-- 1) Las 23 que YA estaban en `proveedores`. No se duplica el dato: se apunta.
insert into bnc_entidades (nombre, proveedor_id, categoria, es_gasto, nota)
select p.nombre, p.id,
       case
         when p.categoria = 'Combustible'   then 'combustible'
         when p.categoria = 'Mantenimiento' then 'mantenimiento'
         when p.categoria = 'Servicios'     then 'servicios'
         when p.categoria = 'Seguros'       then 'seguro'
         else 'otro'
       end,
       true,
       'importado del maestro de proveedores'
from proveedores p
where not exists (select 1 from bnc_entidades e where e.proveedor_id = p.id);

-- sus identificadores, NORMALIZADOS (el banco escribe J501030235, el maestro J-50103023-5)
insert into bnc_entidad_ident (entidad_id, tipo, ident)
select e.id, 'rif', bnc_norm_ident(p.rif)
from bnc_entidades e join proveedores p on p.id = e.proveedor_id
where coalesce(p.rif,'') <> '' and length(bnc_norm_ident(p.rif)) > 5
on conflict (tipo, ident) do nothing;

insert into bnc_entidad_ident (entidad_id, tipo, ident)
select e.id, 'cuenta', bnc_norm_ident(p.ncuenta)
from bnc_entidades e join proveedores p on p.id = e.proveedor_id
where coalesce(p.ncuenta,'') <> '' and length(bnc_norm_ident(p.ncuenta)) > 10
on conflict (tipo, ident) do nothing;

-- 2) Las que NO estaban, dictadas por Máximo el 08/08/2026
with nuevas(nombre, categoria, es_gasto, nota, idents) as (values
  ('FOUND PETROL LIMITED, C.A.', 'compra_divisas', false,
   'Máximo: «found petrol también es compra de dólares». Es el mayor canal de compra de divisas.',
   array['cuenta:01910192402100161459']),

  ('JONÁS GIMÉNEZ', 'compra_divisas', false,
   'Máximo: «pago a socio es compra de dólares». Uno de sus pagos ya lo decía: «- CAMBIO DE MONEDA».',
   array['cedula:V014512243','cuenta:01340326123263032232']),

  ('CARLOS CASTILLO', 'compra_divisas', false,
   'Máximo 08/08: «esos 217.500 son compra de dólares». NO confundir con su hijo Carlos Horacio.',
   array['cedula:V013605857']),

  ('CARLOS HORACIO CASTILLO (uniformes)', 'dotacion', true,
   'Máximo: «es el hijo de él, o sea un proveedor aparte». Uniformes del personal, NO divisas.',
   array['cedula:V030985257']),

  ('RICARDO DEVIS', 'asignacion_1b', true,
   'Máximo: «ricardo davis no es compra de dólares, es asignación» — aunque 2 de sus pagos digan «CAMBIO DE MONEDA» (concepto mal escrito).',
   array['cedula:V031017284','cuenta:01340039390391056578']),

  ('PROYECTOS Y SERVICIOS, C.A.', 'asignacion_1b', true,
   'Sus conceptos dicen «PAGO SOCIO - TIPO B».',
   array['cuenta:01910315312100007292']),

  ('CODIZUCA', 'resp_social', true,
   'Aporte de responsabilidad social 3% sobre las facturas de la Alcaldía.',
   array['cedula:J504589489']),

  ('CUIDADO INTEGRAL DEL AMBIENTE', 'resp_social', true,
   'También aporte social 3%.',
   array['cuenta:01910030812130062231']),

  ('ÁNGEL PAZ (alquiler galpón)', 'alquiler', true,
   'Alquiler del galpón. Máximo: los dueños de El Palotal son los mismos del galpón — misma familia Paz.',
   array['cedula:V025342524']),

  ('MÁXIMO BETANCOURT', 'pago_socio', true,
   'El 7% + 0,5% de ayuda interna. ⚠️ También recibe reembolsos y compras en el exterior: la entidad NO alcanza, desambigua el concepto.',
   array['cuenta:01910192442100161613']),

  ('VIRGINIA ALEJANDRA CASTILLO', 'implantacion_maxware', true,
   'Es Alejandra. Máximo: «trabaja para Maxware pero la paga el cliente que esté usándola mientras configura». NO es nómina fija de Betangar.',
   array[]::text[])
)
insert into bnc_entidades (nombre, categoria, es_gasto, nota)
select n.nombre, n.categoria, n.es_gasto, n.nota
from nuevas n
where not exists (select 1 from bnc_entidades e where e.nombre = n.nombre);

-- sus identificadores
insert into bnc_entidad_ident (entidad_id, tipo, ident)
select e.id, split_part(x, ':', 1), bnc_norm_ident(split_part(x, ':', 2))
from (values
  ('FOUND PETROL LIMITED, C.A.', 'cuenta:01910192402100161459'),
  ('JONÁS GIMÉNEZ', 'cedula:V014512243'),
  ('JONÁS GIMÉNEZ', 'cuenta:01340326123263032232'),
  ('CARLOS CASTILLO', 'cedula:V013605857'),
  ('CARLOS HORACIO CASTILLO (uniformes)', 'cedula:V030985257'),
  ('RICARDO DEVIS', 'cedula:V031017284'),
  ('RICARDO DEVIS', 'cuenta:01340039390391056578'),
  ('PROYECTOS Y SERVICIOS, C.A.', 'cuenta:01910315312100007292'),
  ('CODIZUCA', 'cedula:J504589489'),
  ('CUIDADO INTEGRAL DEL AMBIENTE', 'cuenta:01910030812130062231'),
  ('ÁNGEL PAZ (alquiler galpón)', 'cedula:V025342524'),
  ('MÁXIMO BETANCOURT', 'cuenta:01910192442100161613')
) as v(nom, x)
join bnc_entidades e on e.nombre = v.nom
on conflict (tipo, ident) do nothing;

-- 3) ⚠️ La SEGUNDA cuenta de Auto Unión, la que faltaba en el maestro.
-- Es por donde sale la compra de dólares: sin ella se veían 20 movimientos por
-- Bs 8,8M en vez de 26 por Bs 20,7M.
insert into bnc_entidad_ident (entidad_id, tipo, ident)
select e.id, 'cuenta', bnc_norm_ident('0191-0192-48-2100132111')
from bnc_entidades e where e.nombre ilike 'AUTO UNION%'
on conflict (tipo, ident) do nothing;

update bnc_entidades
   set nota = 'Es la FINANCIADORA de los 12 camiones y a la vez el taller. Recibe compra de dólares (conceptos «asignación»/«cambio de moneda»/«deuda camiones») Y pagos por servicio y repuestos. Cobra por DOS cuentas.'
 where nombre ilike 'AUTO UNION%';

update bnc_entidades
   set nota = 'E/S El Palotal. Máximo: los dueños de la estación son los mismos del galpón alquilado, así que también puede recibir ALQUILER además de combustible.'
 where nombre ilike '%PAZ JIMENEZ%';
