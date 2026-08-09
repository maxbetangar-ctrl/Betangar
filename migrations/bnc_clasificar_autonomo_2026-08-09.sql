-- ============================================================================
-- Betangar · EL SISTEMA SE CLASIFICA SOLO CON LO QUE DA EL BANCO
-- 2026-08-09.
--
-- Máximo: «si el sistema va a reconocer lo del banco, no sé por qué tendrías
-- que guiarte por lo que escriban en el Excel; simplemente lo que no reconozcas
-- se llena a mano, pero del resto todo debería ser con el banco… y lo concilias
-- con la base de datos que tenemos».
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE: **Aurelys se va.** El sistema venía
-- apoyándose en el texto que ella escribía en su Excel para clasificar. Cuando
-- ese archivo deje de existir, lo que dependa de él se queda ciego.
--
-- MEDIDO ANTES DE ESCRIBIR (sobre los 2.412 movimientos del banco):
--   solo Type + diccionario de entidades ......... 40%
--   + cruzar contra EMPLEADOS .................... 86,4%   ← sin mirar el Excel
--   con el texto de la oficina ................... 99,6%
--
-- ⇒ Ninguna fuente sola alcanza. El orden correcto es: primero lo que dice la
--   máquina del banco, después lo que dice NUESTRA base (empleados, entidades),
--   y el texto de la oficina queda de RESPALDO, no de fuente.
--
-- ⚠️ EL CRUCE POR NOMBRE SE ACOTA. La cédula sería lo ideal pero el banco no la
-- trae en los pagos de nómina (0 de 1.062). El nombre sí (79,4%), y por nombre
-- se puede acertar de casualidad — así que se exige:
--   · DOS palabras del nombre del empleado, no una
--   · y que el `Type` sea una forma de pagar nómina (Masivo / Crédito Inmediato)
-- Un pago a «PEREZ» no se toma por nómina solo porque haya un Pérez en la lista.
-- [[norma-nombre-corto-que-apunta-a-dos-personas]]
-- ============================================================================

-- Reconocer a un empleado en el texto del banco. Se aísla en una función para
-- que la regla se pueda leer, probar y corregir en un solo lugar.
create or replace function bnc_es_empleado(txt text)
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from empleados e
     where e.nombre is not null
       and length(e.nombre) > 8
       and array_length(string_to_array(trim(e.nombre), ' '), 1) >= 2
       -- dos palabras del nombre, sin acentos y sin importar mayúsculas
       and upper(translate(coalesce(txt,''),'ÁÉÍÓÚÑáéíóúñ','AEIOUNAEIOUN'))
           like '%'||upper(translate(split_part(trim(e.nombre),' ',1),'ÁÉÍÓÚÑáéíóúñ','AEIOUNAEIOUN'))||'%'
       and upper(translate(coalesce(txt,''),'ÁÉÍÓÚÑáéíóúñ','AEIOUNAEIOUN'))
           like '%'||upper(translate(split_part(trim(e.nombre),' ',2),'ÁÉÍÓÚÑáéíóúñ','AEIOUNAEIOUN'))||'%'
  )
$$;

comment on function bnc_es_empleado is
  'Si el texto del banco nombra a un empleado del padrón (DOS palabras de su nombre, sin acentos). Es lo que permite reconocer la nómina sin depender de que alguien escriba «PAGO DE NÓMINA» en un Excel.';

create or replace function bnc_clasificar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  -- ═══ NIVEL 1 · LO QUE DICE LA MÁQUINA DEL BANCO (Type/Code) ═══
  -- Manda sobre todo lo demás: no se hereda ni se copia mal.
  update bnc_movimientos
     set categoria='impuestos', es_gasto=true,
         clasificado_por='banco:type_pago_impuestos', clasificado_at=now()
   where tipo='debito' and tipo_banco ilike '%PAGO DE IMPUESTOS%'
     and coalesce(categoria,'') is distinct from 'impuestos'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='comision_banco', es_gasto=true,
         clasificado_por='banco:type_comision', clasificado_at=now()
   where tipo='debito' and tipo_banco ilike '%Comisi%'
     and coalesce(categoria,'') is distinct from 'comision_banco'
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 2 · TRASPASO ENTRE CUENTAS PROPIAS ═══
  update bnc_movimientos m
     set categoria='traspaso_interno', es_gasto=false,
         clasificado_por='concepto:traspaso_interno', clasificado_at=now()
    from bnc_cuentas_propias c
   where position(c.cuenta in (coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,''))) > 0
     and c.cuenta is distinct from m.cuenta
     and coalesce(m.tipo_banco,'') !~* 'IMPUESTOS|Comisi'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ═══ ENTRADAS ═══
  update bnc_movimientos
     set categoria='reverso', es_gasto=false, clasificado_por='concepto:reverso', clasificado_at=now()
   where tipo='credito' and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and (coalesce(descripcion,'')||' '||coalesce(concepto_banco,'')) ~* 'devoluci[oó]n recibida|\yreverso\y|pago duplicado|cliente no corresponde|cuenta cancelada|cta\.?invalida'
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='cobro_alcaldia', es_gasto=false, clasificado_por='ident:imau', clasificado_at=now()
   where tipo='credito' and coalesce(categoria,'') not in ('traspaso_interno','reverso')
     and (bnc_norm_ident(coalesce(descripcion,'')||coalesce(concepto_banco,'')) like '%G200060204%'
          or (coalesce(descripcion,'')||' '||coalesce(concepto_banco,'')) ~* 'instituto municipal del aseo|\yimau\y|alcald[ií]a|fc segun factura')
     and coalesce(clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria='otro_ingreso', es_gasto=false, clasificado_por='regla:entrada_sin_identificar', clasificado_at=now()
   where tipo='credito' and coalesce(categoria,'') not in ('traspaso_interno','cobro_alcaldia','reverso')
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 3 · NUESTRA BASE: quién es quién ═══
  -- (a) entidades por identificador fiscal, buscando en el texto DEL BANCO primero
  update bnc_movimientos m
     set entidad_id = i.entidad_id
    from bnc_entidad_ident i
   where m.tipo='debito'
     and bnc_norm_ident(coalesce(m.concepto_banco,'')||coalesce(m.descripcion,'')) like '%'||i.ident||'%'
     and length(i.ident) > 5 and m.entidad_id is distinct from i.entidad_id
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- (b) ⭐ EL EMPLEADO: el banco nombra a quien cobra, y el padrón dice quién es.
  -- Esto es lo que hace que la nómina se reconozca SIN el Excel — 843 de 1.062
  -- pagos «Masivo». Se exige el Type de una forma de pago de nómina para que un
  -- apellido coincidente por casualidad no convierta un pago cualquiera en sueldo.
  update bnc_movimientos m
     set categoria='nomina', es_gasto=true,
         clasificado_por='base:empleado_en_padron', clasificado_at=now()
   where m.tipo='debito' and m.categoria is null
     and m.tipo_banco ~* 'Masivo|Cr[eé]dito Inmediato'
     and bnc_es_empleado(m.concepto_banco)
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 4 · excepciones dentro de la entidad ═══
  update bnc_movimientos m
     set categoria='compra_divisas', es_gasto=false, clasificado_por='concepto:autounion_divisas', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre ilike 'AUTO UNION%'
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'asignaci|consignaci|cambio de moneda|deuda camion'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','nomina')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='alquiler', es_gasto=true, clasificado_por='concepto:palotal_alquiler', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre ilike '%PAZ JIMENEZ%'
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'alquiler|arrendamiento|galp[oó]n'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','nomina')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria='reembolso', es_gasto=true, clasificado_por='concepto:maximo_reembolso', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and e.nombre='MÁXIMO BETANCOURT'
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'reembolso|compras en exterior|devoluci|prestamo|prÉstamo|equipos importados|zoom'
     and coalesce(m.categoria,'') not in ('traspaso_interno','impuestos','comision_banco','nomina')
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria=e.categoria, es_gasto=e.es_gasto, clasificado_por='entidad', clasificado_at=now()
    from bnc_entidades e
   where m.tipo='debito' and m.entidad_id=e.id and m.categoria is null
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 5 · el TEXTO, y el del banco antes que el de la oficina ═══
  -- Queda de respaldo, no de fuente: es lo único que desaparece cuando cambia
  -- quien lleva la administración.
  update bnc_movimientos
     set categoria=v.cat, es_gasto=v.gasto, clasificado_por='banco:concepto_'||v.regla, clasificado_at=now()
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
   where bnc_movimientos.tipo='debito' and bnc_movimientos.categoria is null
     and coalesce(bnc_movimientos.concepto_banco,'') ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  -- el texto de la OFICINA, al final: respaldo del respaldo
  update bnc_movimientos
     set categoria=v.cat, es_gasto=v.gasto, clasificado_por='oficina:concepto_'||v.regla, clasificado_at=now()
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
   where bnc_movimientos.tipo='debito' and bnc_movimientos.categoria is null
     and coalesce(bnc_movimientos.descripcion,'') ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  -- ═══ NIVEL 6 · lo que nadie reconoció: a mano ═══
  update bnc_movimientos
     set categoria='sin_clasificar', es_gasto=true, clasificado_por='ninguna_regla', clasificado_at=now()
   where tipo='debito' and categoria is null
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ═══ EL CANDADO ═══
  update bnc_movimientos set es_gasto=false where tipo='credito' and es_gasto is not false;

  select count(*) into n from bnc_movimientos where categoria is not null;
  return n;
end $$;

revoke all on function bnc_clasificar() from anon, public;
grant execute on function bnc_clasificar() to authenticated;
