-- ═══════════════════════════════════════════════════════════════════════════════
-- EL CLASIFICADOR DEL BANCO APRENDE A LEER EL CONCEPTO — 10/11/2026
--
-- Maximo, hoy: «arregla el clasificador y que lea el concepto».
--
-- ⛔ LOS DOS CASOS QUE LO PIDIERON, los dos con el dato ESCRITO y sin leer:
--
--   1. Bs 15.000.000 a AUTO UNION el 29/10, pago de camiones. El concepto del banco
--      decia literalmente «PAGO CAMION 15000DL 1000T» —los dolares y la tasa— y el
--      movimiento quedo valuado al BCV (889,2553) => US$ 16.868,05 en vez de los
--      US$ 15.000 reales. US$ 1.868,05 inventados, que es lo que el modulo de deuda
--      ofrecia aplicarle al financiamiento.
--
--   2. Bs 4.092.046,84 a CHOURIO ORTIZ el 02/11, cuyo concepto dice «GASOIL 2400 LTS»
--      y que quedo como COMPRA DE DOLARES porque la maquina del banco le puso el
--      `tipo` «Cargo Intervencion Cambiaria». Resultado: US$ 4.600 de gasoil parados
--      en el desplegable de la deuda, listos para que alguien se los acredite a
--      AUTO UNION.
--
-- 📌 En los dos, la verdad venia en `concepto_banco` y se le creyo a otra cosa: al
--    BCV en el primero, al `tipo_banco` en el segundo. Y en los dos quedo
--    `tasa_estimada = false`, o sea AFIRMANDO que el dato era cierto cuando se habia
--    adivinado. Por eso ninguno se veia como un error.
--
-- ⛔ QUE NO HACE: no re-categoriza solo el movimiento de CHOURIO (deja de ser compra
--    de dolares, pero decir que es `combustible` es una decision de Maximo). Y no
--    toca las 26 compras que YA tienen su tasa pactada bien puesta.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────
-- 1. LA TASA SE LEE DEL CONCEPTO CUANDO ESTA ESCRITA
-- ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bnc_cerrar_tasa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v numeric; v_est boolean;
  v_txt text; v_dl numeric; v_t numeric; v_tasa numeric;
begin
  -- Solo si no viene ya con su tasa: una cargada a mano puede ser la REAL de una
  -- operacion negociada, y esa le gana al BCV.
  if new.tasa_real is not null or coalesce(new.moneda,'VES') = 'USD' then return new; end if;

  -- ⭐ EL CONCEPTO MANDA SI TRAE EL DATO (10/11/2026). Maximo escribe en la
  --    transferencia cuantos dolares son y a que tasa: «PAGO CAMION 15000DL 1000T».
  --    Ese es el dato de quien hizo la operacion — mejor que cualquier referencia —
  --    y se estaba tirando. [[norma-falta-de-dato-no-es-un-dato]]
  v_txt := upper(coalesce(new.concepto_banco,'') || ' ' || coalesce(new.descripcion,''));
  v_dl  := nullif(replace(coalesce(substring(v_txt from '([0-9]+(?:[.,][0-9]+)?)[[:space:]]*DL\M'),''), ',', '.'), '')::numeric;
  v_t   := nullif(replace(coalesce(substring(v_txt from '([0-9]+(?:[.,][0-9]+)?)[[:space:]]*T\M'),''), ',', '.'), '')::numeric;
  -- ⛔ HACEN FALTA LAS DOS CIFRAS, Y TIENEN QUE COINCIDIR. Medido el 10/11 sobre los
  --    11 conceptos que traen `DL`: el marcador se REPITE en las lineas hermanas de
  --    la misma operacion. La COMISION de la transferencia a AUTO UNION (Bs 266,19)
  --    arrastra el mismo «14000DL 1000T» del pago, y dividir 266,19 / 14.000 da una
  --    tasa de 0,019 — basura, guardada ademas como CERTEZA. Con un solo marcador no
  --    se puede saber si esta linea es el pago o su comision; con los dos, la cuenta
  --    se comprueba sola: `monto / DL` tiene que dar `T`.
  --    Probado contra las 11: aplica en 3 (las 3 correctas) y rechaza la comision.
  --    [[norma-un-fixture-mal-armado-acusa-al-producto]] [[norma-control-positivo-antes-de-creerle-al-vacio]]
  if v_dl is not null and v_dl > 0 and v_t is not null and v_t > 0
     and new.monto is not null and new.monto > 0 then
    v_tasa := round(new.monto / v_dl, 4);
    if abs(v_tasa - v_t) / v_t <= 0.01 then
      new.tasa_real := v_tasa;
      new.tasa_estimada := false;   -- no es una estimacion: la declaro quien pago
      return new;
    end if;
    -- Si se contradicen, NO se elige una: se sigue de largo y que decida la regla
    -- de abajo. Adivinar cual de las dos vale es como empezo este problema.
  end if;

  -- ⛔ LA COMPRA DE DOLARES NUNCA VA A BCV. Maximo, 24/09: «la compra de dolares
  --    nunca es a tasa bcv, es una tasa del dia en el mercado que nadie sabe sino
  --    hasta el momento que se compran, y ahi es donde esta la perdida por el
  --    diferencial cambiario». Ponerle la del BCV borra justo esa perdida: las
  --    tasas realmente pactadas van 28% a 36% POR ENCIMA del BCV.
  --    El motor ya lo sabia: btg_tasa_mov dice que la compra de dolares SOLO vale
  --    a su tasa pactada y que sin ella no se valua. Se deja NULL y se ve que falta.
  --    EXCEPCION medida: el Cargo Intervencion Cambiaria SI es con el banco y SI va
  --    a BCV (Maximo, 24/09), pero ese entra por otra categoria.
  if coalesce(new.categoria,'') = 'compra_divisas' then return new; end if;

  select bcv_dolar into v from public.tasas_diarias where fecha = new.fecha::date;
  if v is not null then v_est := false;
  else
    select bcv_dolar into v from public.tasas_diarias where fecha <= new.fecha::date order by fecha desc limit 1;
    v_est := true;   -- el BCV no publico ese dia: rige la ultima vigente
  end if;
  new.tasa_real := v; new.tasa_estimada := v_est;
  return new;
end $function$;


-- ───────────────────────────────────────────────────────────────────────────────
-- 2. EL CLASIFICADOR: el concepto le gana al tipo, y una compra al BCV no es segura
-- ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bnc_clasificar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- ⭐ INTERVENCIÓN CAMBIARIA — el banco compra dólares SIN avisar (02/09/2026).
  -- Máximo: «toma bolívares que hayan en la cuenta, lo cambian a dólares y entran en una
  -- cuenta en dólares que tiene Betangar». Llega en TRES líneas con la MISMA referencia:
  --   Cargo Intervencion Cambiaria CARGO    → los bolívares que se lleva
  --   Comision Intervencion Cambiar, COMISI → el 0,5% (ya lo agarra la regla de comisión ↑)
  --   Abono Intervencion Cambiaria ABD840   → los DÓLARES que entran a la cuenta en divisas
  --
  -- ⛔ El CARGO no es gasto: es la misma plata cambiada de moneda. Salió del banco, sí, pero
  -- no se gastó. Estaba cayendo en 'sin_clasificar' con es_gasto=true e inflaba los gastos
  -- en Bs 3.558.310,25 entre las dos operaciones de agosto y septiembre.
  update bnc_movimientos
     set categoria='compra_divisas', es_gasto=false,
         clasificado_por='banco:type_intervencion_cargo', clasificado_at=now()
   where tipo='debito' and tipo_banco ilike '%Intervencion Cambiaria%'
     -- ⛔ Y QUE EL CONCEPTO ACOMPAÑE (10/11/2026). El `tipo_banco` lo pone la maquina
     --    del banco y a veces le pega la etiqueta de intervencion a una transferencia
     --    comun: asi un pago de GASOIL a una persona quedo como compra de dolares y
     --    aparecio en el desplegable de la deuda como US$ 4.600 disponibles para
     --    pagarle a AUTO UNION. Las intervenciones de verdad traen el concepto
     --    «Cargo Intervencion Cambiaria CARGO»; medido: 5 de 5 lo traen, y los 2 que
     --    no, no eran intervenciones. El concepto le gana al tipo.
     --    [[norma-la-palabra-que-identifica-es-la-rara]]
     and coalesce(concepto_banco,'') ilike '%Intervencion%'
     and coalesce(categoria,'') is distinct from 'compra_divisas'
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- ⛔ El ABONO NO es un ingreso, y su monto NO está en bolívares: son los dólares comprados.
  -- Venía como 'otro_ingreso', y como todo `monto` se lee en Bs, US$ 2.500 se contaban como
  -- Bs 2.500. Por eso además se le marca la moneda.
  update bnc_movimientos
     set categoria='divisas_recibidas', es_gasto=false, moneda='USD',
         clasificado_por='banco:type_intervencion_abono', clasificado_at=now()
   where tipo='credito' and tipo_banco ilike '%Intervencion Cambiaria%'
     and coalesce(categoria,'') is distinct from 'divisas_recibidas'
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
   where tipo='credito' and coalesce(categoria,'') not in ('traspaso_interno','cobro_alcaldia','reverso','divisas_recibidas')
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
     and (coalesce(m.descripcion,'')||' '||coalesce(m.concepto_banco,'')) ~* 'asignaci|consignaci|cambio de moneda|deuda camion|pago camion'
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

  -- ═══ UNA COMPRA DE DOLARES VALUADA AL BCV NO PUEDE DECIR QUE ESTA SEGURA ═══
  -- ⛔ EL DEFECTO ERA DE ORDEN, NO DE REGLAS (10/11/2026). `trg_bnc_cerrar_tasa`
  --    corre BEFORE INSERT OR UPDATE OF fecha, monto, moneda — NO cuando cambia la
  --    categoria. El movimiento entra del banco con `categoria` NULL, el trigger no
  --    ve todavia que es una compra y le pone el BCV del dia; despues esta funcion
  --    lo marca `compra_divisas`, pero la tasa YA esta puesta y `bnc_exige_tasa_compra`
  --    solo chilla cuando esta en NULL. El diseño era correcto y la secuencia lo anulaba.
  --    Asi, Bs 15.000.000 pagados a AUTO UNION el 29/10 a tasa pactada 1.000 figuraban
  --    como US$ 16.868,05 en vez de US$ 15.000: US$ 1.868,05 inventados.
  --    No se puede poner la tasa en NULL aca: `bnc_exige_tasa_compra` lanzaria excepcion
  --    y este clasificador dejaria de correr entero. Un candado que rompe la herramienta
  --    es peor que no tener candado. Se deja el valor y se le quita la CERTEZA, que es
  --    lo que mentia. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  --    ⛔ MENOS LA INTERVENCION CAMBIARIA, QUE SI VA A BCV (Maximo, 24/09): ahi el
  --       BCV no es una suposicion, es la tasa de la operacion. El primer intento de
  --       esto marco las 3 intervenciones legitimas como «tasa supuesta» y el
  --       desplegable de la deuda les ponia una advertencia a compras correctas. Un
  --       aviso que salta sobre lo que esta bien deja de significar algo.
  --       [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
  update bnc_movimientos m
     set tasa_estimada = true
    from public.tasas_diarias t
   where m.categoria = 'compra_divisas'
     and m.tasa_estimada is not true
     and coalesce(m.concepto_banco,'') not ilike '%Intervencion%'
     and m.fecha ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     and t.fecha = substring(m.fecha from 1 for 10)::date
     and m.tasa_real = t.bcv_dolar;

  select count(*) into n from bnc_movimientos where categoria is not null;
  return n;
end $function$;


-- ───────────────────────────────────────────────────────────────────────────────
-- 3. EL DESPLEGABLE DE LA DEUDA AVISA CUANDO LA TASA NO ES LA PACTADA
-- ⛔ Hasta hoy `problema` solo hablaba si FALTABA la tasa. Una compra valuada al BCV
--    no tiene el campo vacio: tiene un numero EQUIVOCADO, que es peor, porque se
--    ofrece como dolares disponibles sin que nada lo distinga de una compra real.
--    [[norma-la-falta-de-un-dato-no-es-un-dato]]
-- ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deuda_compras_disponibles()
 RETURNS TABLE(mov_id text, fecha date, quien text, bs numeric, tasa numeric, usd numeric, usd_aplicado numeric, usd_libre numeric, problema text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with compras as (
    select m.id,
           case when m.fecha ~ '^\d{4}-\d{2}-\d{2}' then substring(m.fecha from 1 for 10)::date end as f,
           coalesce(nullif(btrim(e.nombre),''), left(coalesce(m.descripcion,'(sin descripción)'), 42)) as quien,
           m.monto,
           m.tasa_real,
           m.tasa_estimada,
           case when coalesce(m.tasa_real,0) > 0 then round(m.monto / m.tasa_real, 2) end as usd
    from public.bnc_movimientos m
    left join public.bnc_entidades e on e.id = m.entidad_id
    where m.categoria = 'compra_divisas'
  ), aplicado as (
    select a.mov_id, sum(a.monto) as usd_aplicado
    from public.deuda_abonos a where a.mov_id is not null group by a.mov_id
  )
  select c.id, c.f, c.quien, c.monto, c.tasa_real, c.usd,
         coalesce(ap.usd_aplicado, 0),
         case when c.usd is null then null else c.usd - coalesce(ap.usd_aplicado, 0) end,
         case when c.usd is null then 'Le falta la tasa a la que se compró: sin eso no se sabe cuántos dólares son.'
              when c.f  is null then 'La fecha del movimiento no tiene forma de fecha.'
              when c.tasa_estimada then 'Esta valuada a una tasa SUPUESTA, no a la pactada: los dólares que muestra pueden no ser los que se compraron. Cargale la tasa real antes de aplicarla.'
         end
  from compras c left join aplicado ap on ap.mov_id = c.id
  where public.btg_ve_financiero()
  order by c.f nulls first, c.id;
$function$;
