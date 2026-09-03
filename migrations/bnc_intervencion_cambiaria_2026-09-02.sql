-- ════════════════════════════════════════════════════════════════════════════════════════════
-- INTERVENCIÓN CAMBIARIA — el banco compra dólares SIN avisar  (02/09/2026)
--
-- 🔬 QUÉ ES. Máximo, 02/09: «el banco toma bolívares que hayan en la cuenta, y lo cambian a
--    dólares y entran en una cuenta en dólares que tiene Betangar, pero como lo hacen sin avisar
--    me gustaría que sepas registrarlo». Cobran además un 0,5% de comisión.
--
--    Llega en TRES líneas del estado de cuenta, con la MISMA referencia:
--      · `Cargo Intervencion Cambiaria CARGO`     débito  · los bolívares que se lleva
--      · `Comision Intervencion Cambiar, COMISI`  débito  · el 0,5%
--      · `Abono Intervencion Cambiaria ABD840`    crédito · los DÓLARES que entran
--
--    Medido sobre las dos operaciones que hay (capturas del banco que mandó Máximo, 02/09):
--      24/08 ref 25265  · Bs 1.961.658,25 + Bs 9.808,29 → US$ 2.500  (784,6633 Bs/$)
--      01/09 ref 262610 · Bs 1.596.652,00 + Bs 7.983,26 → US$ 2.000  (798,3260 Bs/$)
--    La comisión da 0,500000% EXACTO en las dos. Suman US$ 4.500, que es lo que Máximo contó.
--
-- ⛔ CÓMO ESTABA. Ninguna regla reconocía el concepto del banco, así que:
--    · el CARGO caía en `sin_clasificar` con **es_gasto = true** → Bs 3.558.310,25 (≈US$ 4.478)
--      contados como gasto cuando NO se gastó nada: es la misma plata en otra moneda.
--      [[norma-salida-de-banco-no-es-gasto]]
--    · el ABONO caía en `otro_ingreso`, y como TODO `monto` se lee en bolívares, los
--      **US$ 4.500 se contaban como Bs 4.500**. Ni es ingreso ni son bolívares.
--
-- 📌 LO QUE NO SE INVENTA. Los dólares NO se calculan dividiendo por el BCV: los DICE el banco
--    en la línea del abono. Y hace falta que sea así — el 24/08 el banco liquidó a 784,6633, que
--    es el BCV del **23/08**, no el del 24/08 (785,0693). Dividiendo por el BCV del día darían
--    2.498,71 dólares en vez de los 2.500 reales. La tasa se DEDUCE de la operación
--    (cargo ÷ abono), no al revés. [[norma-fuente-unica-datos]] · [[norma-respaldo-que-inventa-un-dato]]
--
-- ⛔ Y SE RESPETA EL CANDADO de `btg_tasa_mov` (Máximo, 09/08): «la compra de dólares es lo único
--    que SIEMPRE tiene una tasa completamente diferente a todas las tasas que tenemos». Acá no se
--    cae a BCV: la tasa se mide de la propia operación. Si faltara la pata del abono, `tasa_real`
--    queda NULL, la operación aparece en `v_divisas_sin_tasa` y se pregunta. No se estima.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table _ic_log(paso text, detalle text) on commit preserve rows;

-- ── 0) CONTROL ANTES: cómo están hoy las seis líneas ────────────────────────────────────────
insert into _ic_log
select '0. antes',
       tipo_banco||' → categoria='||coalesce(categoria,'(null)')||
       ' es_gasto='||coalesce(es_gasto::text,'(null)')||' tasa_real='||coalesce(tasa_real::text,'(null)')
  from public.bnc_movimientos where tipo_banco ilike '%Intervencion Camb%';

-- ── 1) LA MONEDA DE LA FILA ─────────────────────────────────────────────────────────────────
-- Sin esto no hay forma de distinguir US$ 2.500 de Bs 2.500: son el mismo número en `monto`.
-- Se arregla el MECANISMO, no las dos filas. [[norma-arreglar-el-mecanismo-no-el-caso]]
alter table public.bnc_movimientos
  add column if not exists moneda text not null default 'VES';
alter table public.bnc_movimientos drop constraint if exists bnc_mov_moneda_valida;
alter table public.bnc_movimientos add constraint bnc_mov_moneda_valida
  check (moneda in ('VES','USD','EUR'));
comment on column public.bnc_movimientos.moneda is
  'En qué moneda está `monto`. VES por defecto. USD en el abono de una intervención cambiaria: el banco declara ahí los dólares comprados, no bolívares.';
insert into _ic_log values ('1. columna moneda', 'creada (default VES) + check');

-- ── 2) LA CATEGORÍA NUEVA ───────────────────────────────────────────────────────────────────
-- ⚠️ El catálogo vive en TRES sitios (ver `bnc_categoria_check_2026-08-09.sql`): este CHECK,
--    `REL_CATS` en app.js y `NOMBRE_CAT` en herramientas/relacion-gastos-excel.mjs. Los tres.
alter table public.bnc_movimientos drop constraint if exists bnc_mov_categoria_valida;
alter table public.bnc_movimientos add constraint bnc_mov_categoria_valida
  check (categoria is null or categoria in ('alquiler','asignacion_1b','bienestar_personal','caja_chica','cobro_alcaldia','combustible','comision_banco','compra_divisas','compra_software','divisas_recibidas','dotacion','duplicado','gasto','implantacion_maxware','impuestos','mantenimiento','nomina','otro','otro_ingreso','pago_socio','parafiscales','prestamo_empleado','prueba_sistema','reembolso','resp_social','reverso','seguro','servicios','sin_clasificar','software','tramites','transito_terceros','traspaso_interno','⏳pendiente_explicar'))
  not valid;
alter table public.bnc_movimientos validate constraint bnc_mov_categoria_valida;
insert into _ic_log values ('2. categoria', 'divisas_recibidas agregada al CHECK');

-- ── 3) EL CLASIFICADOR ──────────────────────────────────────────────────────────────────────
-- Las reglas nuevas van en NIVEL 1 porque las dicta la MÁQUINA del banco (`tipo_banco`), que es
-- lo que ese nivel existe para atender. Y se agrega `divisas_recibidas` a la lista de exclusión
-- de la regla de fondo de ENTRADAS: sin eso, la corrida siguiente de `bnc-traer` volvería a
-- marcar el abono como `otro_ingreso` y el arreglo se desharía solo.
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
end $function$
;

insert into _ic_log values ('3. bnc_clasificar', 'reglas de intervención cambiaria en NIVEL 1 + exclusión en ENTRADAS');

-- ── 4) ATAR LAS TRES PATAS Y MEDIR LA TASA ──────────────────────────────────────────────────
-- La referencia del banco es el PRIMER campo de `referencia` ('25265 / 27434150 / 400230021897').
-- La tasa NO se toma del BCV: se mide dividiendo lo que el banco se llevó entre lo que entregó.
-- Si falta la pata del abono no se estima nada: `tasa_real` queda NULL y la operación sale en
-- `v_divisas_sin_tasa`, que es el aviso de «esto no se puede valuar, hay que preguntarlo».
create or replace function public.btg_atar_intervencion_cambiaria()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare n integer := 0;
begin
  with op as (
    select split_part(referencia, ' / ', 1) as ref_banco, fecha,
           max(case when tipo='debito'  and tipo_banco ilike '%Cargo Intervencion%' then monto end) as bs_cargo,
           max(case when tipo='credito' and tipo_banco ilike '%Abono Intervencion%' then monto end) as usd
      from bnc_movimientos
     where tipo_banco ilike '%Intervencion Camb%'
       and coalesce(referencia,'') <> ''
     group by 1, 2
  )
  update bnc_movimientos m
     set tasa_real = round(op.bs_cargo / op.usd, 4), tasa_estimada = false
    from op
   where split_part(m.referencia, ' / ', 1) = op.ref_banco
     and m.fecha = op.fecha
     and m.tipo = 'debito' and m.tipo_banco ilike '%Cargo Intervencion%'
     and op.usd > 0 and op.bs_cargo > 0
     and m.tasa_real is distinct from round(op.bs_cargo / op.usd, 4)
     and coalesce(m.clasificado_por,'') not like 'manual:%';
  get diagnostics n = row_count;
  return n;
end $fn$;

comment on function public.btg_atar_intervencion_cambiaria is
  'Mide la tasa de cada compra de dólares que hizo el BANCO, dividiendo el cargo en Bs entre los dólares que el propio banco declara en el abono. No estima: sin la pata del abono deja la tasa en NULL.';

revoke all on function public.btg_atar_intervencion_cambiaria() from anon, public;
grant execute on function public.btg_atar_intervencion_cambiaria() to authenticated, service_role;
insert into _ic_log values ('4. btg_atar_intervencion_cambiaria', 'creada');

-- ── 5) LA OPERACIÓN COMPLETA, EN UNA FILA ───────────────────────────────────────────────────
-- Es lo que lee el aviso y lo que se muestra en pantalla: las tres líneas sueltas del banco no
-- se entienden por separado. `security_invoker` porque una vista NO tiene RLS propio.
-- [[norma-vista-no-tiene-rls-y-son-cuatro-verbos]]
create or replace view public.v_intervencion_cambiaria
with (security_invoker = true) as
with patas as (
  select split_part(referencia, ' / ', 1) as ref_banco, fecha,
         max(case when tipo='debito'  and tipo_banco ilike '%Cargo Intervencion%'    then monto end)  as bs_debitado,
         max(case when tipo='debito'  and tipo_banco ilike '%Comision Intervencion%' then monto end)  as bs_comision,
         max(case when tipo='credito' and tipo_banco ilike '%Abono Intervencion%'    then monto end)  as usd_recibidos,
         max(case when tipo='debito'  and tipo_banco ilike '%Cargo Intervencion%'    then cuenta end) as cuenta_origen,
         max(case when tipo='credito' and tipo_banco ilike '%Abono Intervencion%'    then cuenta end) as cuenta_destino,
         max(case when tipo='debito'  and tipo_banco ilike '%Cargo Intervencion%'    then id end)     as id_cargo
    from bnc_movimientos
   where tipo_banco ilike '%Intervencion Camb%' and coalesce(referencia,'') <> ''
   group by 1, 2
)
select p.ref_banco, p.fecha, p.cuenta_origen, p.cuenta_destino, p.id_cargo,
       p.bs_debitado, p.bs_comision, p.usd_recibidos,
       coalesce(p.bs_debitado,0) + coalesce(p.bs_comision,0) as bs_total,
       case when p.usd_recibidos > 0 then round(p.bs_debitado / p.usd_recibidos, 4) end   as tasa_operacion,
       case when p.bs_debitado  > 0 then round(100 * p.bs_comision / p.bs_debitado, 4) end as comision_pct,
       -- ⚠️ `bnc_movimientos.fecha` es TEXT y `tasas_diarias.fecha` es DATE: sin el cast esto
       -- ni siquiera crea la vista («operator does not exist: date = text»).
       (select t.bcv_dolar from tasas_diarias t where t.fecha = p.fecha::date)             as bcv_del_dia,
       (p.usd_recibidos is null)                                                           as falta_el_abono
  from patas p;

comment on view public.v_intervencion_cambiaria is
  'Cada compra de dólares que hizo el BANCO por su cuenta, con sus tres patas juntas: los Bs que se llevó, el 0,5% de comisión y los US$ que entregó. La tasa sale de la propia operación, no del BCV. `falta_el_abono` marca las que no se pueden valuar.';

revoke all on public.v_intervencion_cambiaria from anon, public;
grant select on public.v_intervencion_cambiaria to authenticated, service_role;
insert into _ic_log values ('5. v_intervencion_cambiaria', 'creada');

-- ── 6) CORRER ───────────────────────────────────────────────────────────────────────────────
insert into _ic_log select '6. clasificados',  public.bnc_clasificar()::text;
insert into _ic_log select '6. tasas medidas', public.btg_atar_intervencion_cambiaria()::text;

-- ── 7) CONTROL DESPUÉS ──────────────────────────────────────────────────────────────────────
insert into _ic_log
select '7. despues',
       tipo_banco||' → categoria='||coalesce(categoria,'(null)')||
       ' es_gasto='||coalesce(es_gasto::text,'(null)')||' moneda='||moneda||
       ' tasa_real='||coalesce(tasa_real::text,'(null)')
  from public.bnc_movimientos where tipo_banco ilike '%Intervencion Camb%';

insert into _ic_log
select '7. operacion',
       fecha::text||' ref '||ref_banco||' · Bs '||bs_debitado||' + com '||bs_comision||
       ' → US$ '||usd_recibidos||' · tasa '||tasa_operacion||' · com '||comision_pct||'%'||
       ' · BCV del dia '||coalesce(bcv_del_dia::text,'(sin tasa)')
  from public.v_intervencion_cambiaria;

-- ⛔ CONTROL NEGATIVO: que no se haya movido nada más. Si esto no da 0, algo se llevó por delante
-- filas que no eran de esta operación. [[norma-el-vacio-no-acusa-hasta-el-control-negativo]]
insert into _ic_log
select '7. control negativo',
       'movimientos tocados hoy que NO son intervención cambiaria: '||count(*)::text
  from public.bnc_movimientos
 where clasificado_por like 'banco:type_intervencion%'
   and tipo_banco not ilike '%Intervencion Camb%';

insert into _ic_log
select '7. gastos', 'sigue habiendo '||count(*)::text||' movimientos sin clasificar (antes de esto eran 2 más)'
  from public.bnc_movimientos where categoria = 'sin_clasificar';

select * from _ic_log order by paso;
