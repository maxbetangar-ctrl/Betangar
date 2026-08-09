-- ============================================================================
-- Betangar · clasificar los movimientos del banco. LA CATEGORÍA QUEDA GUARDADA.
-- Nunca pisa lo que decidió una persona (clasificado_por like 'manual:%').
-- ============================================================================

-- ---------------------------------------------------------------- (a) ENTIDAD
-- Se busca el identificador NORMALIZADO dentro del texto del movimiento.
-- Sin normalizar da cero: el banco escribe J501030235, el maestro J-50103023-5.
update bnc_movimientos m
   set entidad_id = i.entidad_id
  from bnc_entidad_ident i
 where bnc_norm_ident(m.descripcion) like '%' || i.ident || '%'
   and length(i.ident) > 5
   and m.entidad_id is distinct from i.entidad_id
   and coalesce(m.clasificado_por,'') not like 'manual:%';

-- ------------------------------------------- (b) EXCEPCIONES DENTRO DE ENTIDAD
-- Hay entidades que reciben MÁS DE UNA COSA: la entidad sola no puede decidir.

-- AUTO UNIÓN: financiadora y taller a la vez. Máximo: «varios que fueron para
-- compra de dólares dicen asignación en pagos a autounion, es decir error de tipeo».
update bnc_movimientos m
   set categoria = 'compra_divisas', es_gasto = false, clasificado_por = 'concepto:autounion_divisas',
       clasificado_at = now()
  from bnc_entidades e
 where m.entidad_id = e.id and e.nombre ilike 'AUTO UNION%'
   and m.descripcion ~* 'asignaci|consignaci|cambio de moneda|deuda camion'
   and coalesce(m.clasificado_por,'') not like 'manual:%';

-- COMERCIALIZADORA PAZ JIMÉNEZ (El Palotal): los dueños de la estación son los
-- mismos del galpón alquilado, así que también puede cobrar ALQUILER.
update bnc_movimientos m
   set categoria = 'alquiler', es_gasto = true, clasificado_por = 'concepto:palotal_alquiler',
       clasificado_at = now()
  from bnc_entidades e
 where m.entidad_id = e.id and e.nombre ilike '%PAZ JIMENEZ%'
   and m.descripcion ~* 'alquiler|arrendamiento|galp[oó]n'
   and coalesce(m.clasificado_por,'') not like 'manual:%';

-- MÁXIMO BETANCOURT: además del 7,5% recibe reembolsos y compras en el exterior.
update bnc_movimientos m
   set categoria = 'reembolso', es_gasto = true, clasificado_por = 'concepto:maximo_reembolso',
       clasificado_at = now()
  from bnc_entidades e
 where m.entidad_id = e.id and e.nombre = 'MÁXIMO BETANCOURT'
   and m.descripcion ~* 'reembolso|compras en exterior|devoluci|prestamo|prÉstamo|equipos importados|zoom'
   and coalesce(m.clasificado_por,'') not like 'manual:%';

-- La comisión bancaria es una línea aparte aunque vaya al mismo beneficiario.
update bnc_movimientos
   set categoria = 'comision_banco', es_gasto = true, clasificado_por = 'concepto:comision',
       clasificado_at = now()
 where descripcion ~* 'comisi[oó]n bancaria|comision x cred|comisi[oó]n mantenimiento'
   and coalesce(clasificado_por,'') not like 'manual:%';

-- --------------------------------------------------- (c) DEFAULT DE LA ENTIDAD
update bnc_movimientos m
   set categoria = e.categoria, es_gasto = e.es_gasto, clasificado_por = 'entidad',
       clasificado_at = now()
  from bnc_entidades e
 where m.entidad_id = e.id
   and m.categoria is null
   and coalesce(m.clasificado_por,'') not like 'manual:%';

-- ------------------------------- (d) POR CONCEPTO, para los que no traen ident
-- 437 débitos no traen ni cédula ni cuenta en el texto. Van por lo que declaró
-- la administración. El orden importa: lo más específico primero.
update bnc_movimientos
   set categoria = v.cat, es_gasto = v.gasto, clasificado_por = 'concepto:'||v.regla,
       clasificado_at = now()
  from (values
    ('prestamo_empleado', false, 'prestamo',    '(prestamo|préstamo).*(empleado|medicament)|prestamo a empleado'),
    ('pago_socio',        true,  'socio',       'pago a socio|pago socio|fiel cumpl|sociedad betangar|abono 0,5|reparto de dividendo'),
    ('resp_social',       true,  'resp_social', 'resp\.? *social|responsabilidad social|aporte social'),
    ('impuestos',         true,  'impuestos',   'seniat|\yislr\y|\yiva\y|impuesto|retenc|\ydpp\y|pensionad'),
    ('nomina',            true,  'nomina',      'n[oó]mina|\ysem ?\d'),
    ('combustible',       true,  'combustible', 'gasoil|combustible|gasolina'),
    ('seguro',            true,  'seguro',      'seguro m[eé]dico|salud zulia'),
    ('software',          true,  'software',    'galac|sofware|software'),
    ('tramites',          true,  'tramites',    '\yrnc\y|bombero|arancel|permiso|solvencia'),
    ('dotacion',          true,  'dotacion',    'uniforme|chaleco|dotaci'),
    ('mantenimiento',     true,  'mantto',      'servicio a unidad|mantenimiento|filtro|aceite|repuesto|caucho|goma|llanta|lavado'),
    ('implantacion_maxware', true, 'alejandra', 'virginia castillo|apoyo administrativo')
  ) as v(cat, gasto, regla, patron)
 where bnc_movimientos.categoria is null
   and bnc_movimientos.descripcion ~* v.patron
   and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

-- ------------------------------------------------------------------ (e) RESTO
update bnc_movimientos
   set categoria = 'sin_clasificar', es_gasto = true, clasificado_por = 'ninguna_regla',
       clasificado_at = now()
 where categoria is null
   and coalesce(clasificado_por,'') not like 'manual:%';
