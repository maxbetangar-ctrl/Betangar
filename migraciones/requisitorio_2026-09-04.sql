-- ════════════════════════════════════════════════════════════════════════════
-- EL REQUISITORIO — el pedido que le falta al circuito
-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-04. Diseñado con Máximo sobre cómo trabaja TONY GAS:
--
--   checklist → anomalía → el mecánico o el jefe de servicio hace un REQUISITORIO
--   → compras (área administrativa) pide presupuestos y escoge → firma el
--   Director → recién ahí se emite la orden de servicio → sigue lo que ya existe.
--
-- Las dos puntas ya estaban bien hechas: `anomalias` (la falla queda ABIERTA
-- hasta que alguien la cierre) y `ordenes_servicio` + `cxp.orden_id` (la factura
-- ya se engancha con la orden).
--
-- ⛔ EL MEDIO NO ESTABA FLOJO: ESTABA ABIERTO. Cualquiera con el rol emite una
--    orden SIN que nadie la haya pedido ni aprobado, y la factura entra después
--    contra esa orden. El dinero tiene papel; la DECISIÓN de gastarlo no.
--
-- ── LA REGLA DURA, ÚNICA ────────────────────────────────────────────────────
--     Una orden de servicio o de compra NACE de un requisitorio.
--     No se escribe a mano.
--
-- Se enciende con `configuracion.req_obliga_orden = 'true'`. ⛔ Nace APAGADA:
-- Betangar, Flotilla y VIDECA llevan meses emitiendo órdenes a mano y un candado
-- duro les dejaría el producto MUERTO el día del despliegue. Tony Gas arranca en
-- cero y puede nacer con el candado puesto.
-- [[norma-cliente-que-paga-se-revisa-entero]] · [[norma-catalogo-no-puede-trancar-el-registro]]
--
-- ── POR QUÉ ESTAS TABLAS Y NO OTRAS ─────────────────────────────────────────
-- · NO se llama «requisiciones de mantenimiento». En Tony Gas se pide de todo:
--   repuestos, insumos de planta, papelería de oficina. Es el circuito de
--   compras de la empresa, y por eso el destino no es solo una unidad.
-- · Las reglas de aprobación viven en su propia tabla y con una columna
--   `documento`: mañana el mismo motor decide quién autoriza un descuento o una
--   nota de crédito en otro producto. El motor se replica, los números no.
--   [[norma-intervalo-mantenimiento-por-empresa]]
-- · Cada paso guarda SU HORA. Sin eso no se puede decir «el TTG-07 estuvo 11
--   días parado: 6 esperando aprobación», que es el número que hoy no tiene
--   ninguna empresa de este tamaño. [[norma-numero-que-el-dueno-no-puede-explicar]]
-- · Los ids son TEXTO generados por la app ('RQ'+timestamp), como el resto de
--   las tablas operativas: es lo que permite que la cola offline reintente con
--   `upsert(onConflict:'id')` sin duplicar.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. LA CABECERA ──────────────────────────────────────────────────────────
create table if not exists public.requisiciones (
  id                text primary key,
  numero            integer,                  -- lo pone la BASE, no la app
  codigo            text,                     -- 'REQ-00042', derivado de numero
  fecha             date        not null default (now() at time zone 'America/Caracas')::date,

  -- De dónde nace. Una falla del checklist, un preventivo vencido, o suelto
  -- (papelería, planta). `origen_ref` guarda el id de la anomalía o del ítem.
  origen            text        not null default 'suelto'
                    check (origen in ('anomalia','preventivo','suelto')),
  origen_ref        text,

  -- Para qué es. La orden ya sabía llegar a «Patio» e «Inventario»; acá se
  -- agrega `area` para lo que no es de la flota (oficina, planta, galpón).
  destino           text        not null default 'unidad'
                    check (destino in ('unidad','patio','inventario','area')),
  cam               text,
  area              text,

  -- ⛔ La urgencia se escribe como la dice la gente, no como una escala 1-5:
  --    una escala la interpreta distinto cada persona y entonces todo llega
  --    urgente. `consecuencia` es lo que le permite a quien firma priorizar.
  urgencia          text        not null default 'cuando_se_pueda'
                    check (urgencia in ('no_sale','esta_semana','cuando_se_pueda')),
  consecuencia      text,

  solicitante       text        not null,
  solicitante_rol   text,

  estado            text        not null default 'enviada'
                    check (estado in ('borrador','enviada','tomada','cotizando',
                                      'espera_firma','aprobada','rechazada',
                                      'anulada','atendida','recibida','cerrada')),

  -- El reloj: cada mano deja su hora y su nombre. Es lo que se mide después.
  enviada_at        timestamptz default now(),
  tomada_at         timestamptz,  tomada_por     text,
  cotizada_at       timestamptz,
  firma_pedida_at   timestamptz,
  decidida_at       timestamptz,  decidida_por   text,
  decision_nota     text,
  atendida_at       timestamptz,
  recibida_at       timestamptz,  recibida_por   text,
  cerrada_at        timestamptz,

  monto_estimado_usd numeric(14,2),
  monto_aprobado_usd numeric(14,2),

  -- Quién tenía que firmar, resuelto por las reglas EN EL MOMENTO de pedirlo.
  -- Se guarda: si mañana cambian las reglas, el papel de ayer sigue diciendo la
  -- verdad de ayer. [[norma-el-documento-no-es-el-dato-de-hoy]]
  aprueba_rol       text,
  aprueba_usuario   text,
  regla_aplicada    text,
  token             text,                     -- el enlace de la firma, un solo uso

  orden_id          text,                     -- la OS/OC que nació de este pedido
  emergencia        boolean not null default false,
  ratificada_at     timestamptz,              -- la emergencia se ratifica después
  nota              text,
  created_at        timestamptz not null default now()
);

create unique index if not exists requisiciones_numero_key on public.requisiciones(numero);
create unique index if not exists requisiciones_token_key  on public.requisiciones(token) where token is not null;
create index if not exists requisiciones_estado_idx  on public.requisiciones(estado);
create index if not exists requisiciones_cam_idx     on public.requisiciones(cam);
create index if not exists requisiciones_fecha_idx   on public.requisiciones(fecha desc);
create index if not exists requisiciones_origen_idx  on public.requisiciones(origen, origen_ref);

-- ── 2. LOS RENGLONES ────────────────────────────────────────────────────────
-- ⛔ Un requisitorio NO es un párrafo. Si lo que se pide es texto libre, compras
--    cotiza mal y después no hay forma de comparar tres ofertas renglón a
--    renglón. Qué, cuánto, de qué.
create table if not exists public.req_lineas (
  id            text primary key,
  req_id        text not null references public.requisiciones(id) on delete cascade,
  orden         integer not null default 1,
  item          text not null,
  cantidad      numeric(14,3) not null default 1 check (cantidad > 0),
  unidad        text default 'pieza',
  especificacion text,

  -- Si el renglón está en el almacén, este renglón NO va a compras. El dato lo
  -- pone la pantalla al escribir, leyendo `inventario`.
  inv_id        text,
  desde_almacen boolean not null default false,
  item_id       text,                          -- catálogo `mant_items`, si aplica
  categoria     text,                          -- `cat_categorias`; manda en las reglas
  created_at    timestamptz not null default now()
);
create index if not exists req_lineas_req_idx on public.req_lineas(req_id);

-- ── 3. LAS OFERTAS ──────────────────────────────────────────────────────────
-- Tres, o UNA con el motivo escrito. Quien firma tiene que ver el cuadro, no una
-- cifra: aprobar a ciegas es firmar, no decidir.
create table if not exists public.req_cotizaciones (
  id            text primary key,
  req_id        text not null references public.requisiciones(id) on delete cascade,
  proveedor_id  text,
  proveedor     text not null,
  monto_usd     numeric(14,2) not null check (monto_usd >= 0),
  dias_entrega  integer,
  nota          text,
  recomendada   boolean not null default false,  -- la que propone compras
  elegida       boolean not null default false,  -- la que decidió quien firma
  motivo_eleccion text,   -- por qué NO la más barata, cuando no lo es
  archivo_url   text,
  cargada_por   text,
  created_at    timestamptz not null default now()
);
create index if not exists req_cotizaciones_req_idx on public.req_cotizaciones(req_id);

-- ── 4. QUIÉN FIRMA QUÉ — el motor, no el número ─────────────────────────────
-- ⛔ Nace VACÍA a propósito. Sin reglas, `req_quien_aprueba()` manda todo al
--    tope, que es exactamente como trabaja Tony Gas hoy: todo pasa por el
--    Director. Aflojarlo es una decisión suya, escrita acá.
--    [[norma-default-en-campo-que-se-declara]]
create table if not exists public.req_reglas (
  id            text primary key,
  documento     text not null default 'requisitorio',  -- el motor sirve para otros
  activa        boolean not null default true,
  prioridad     integer not null default 100,          -- menor = se evalúa antes
  monto_desde   numeric(14,2),
  monto_hasta   numeric(14,2),
  categoria     text,          -- null = cualquiera
  destino       text,          -- null = cualquiera
  siempre       boolean not null default false,        -- el «sí o sí», sin importar monto
  aprueba_rol   text,
  aprueba_usuario text,
  nota          text,
  creada_por    text,
  created_at    timestamptz not null default now()
);

-- ── 5. LA SUPLENCIA ─────────────────────────────────────────────────────────
-- El único `directivo` de Tony Gas tiene teléfono de otro país y no siempre está.
-- Sin esto, cuando el dueño viaja pasa una de dos: se paraliza todo, o alguien
-- compra sin firma «porque era urgente» — y el circuito se rompe justo el día
-- que más falta hacía. Es una DELEGACIÓN con fecha y tope, no un cambio de rol.
create table if not exists public.req_delegaciones (
  id            text primary key,
  de_usuario    text not null,
  a_usuario     text not null,
  desde         date not null,
  hasta         date not null,
  tope_usd      numeric(14,2),
  motivo        text,
  creada_por    text,
  created_at    timestamptz not null default now(),
  check (hasta >= desde)
);
create index if not exists req_delegaciones_vig_idx on public.req_delegaciones(desde, hasta);

-- ── 6. EL CORRELATIVO LO LLEVA LA BASE ──────────────────────────────────────
-- [[norma-contador-lo-mantiene-la-base-no-la-app]]. Y arranca donde el cliente
-- venía numerando a mano: `configuracion.req_numero_inicial`.
-- [[norma-correlativo-se-sincroniza-con-lo-importado]]
create sequence if not exists public.req_numero_seq as integer start with 1;

-- ⚠️ UNA SECUENCIA NO SE DESHACE CON UN `rollback`: `nextval` es lo único que no
--    vuelve atrás. Medido el 04/09/2026 corriendo la prueba dos veces dentro de
--    transacciones que se deshacían — la base quedó en 0 filas y el contador en 7.
--    En un documento que se audita, un hueco en el correlativo se lee como un
--    papel que desapareció, así que:
--      · un BORRADOR no consume número (se lo gana al enviarse);
--      · una ANULADA conserva el suyo — anular no es borrar, y el hueco con
--        motivo escrito sí es explicable.
--    Lo que no se hace es numerar con `max(numero)+1`: eso serializa a todos los
--    que piden al mismo tiempo, y el día que la planta y el taller pidan juntos
--    uno de los dos se queda esperando.
create or replace function public.req_set_numero()
returns trigger
language plpgsql
as $$
declare ini integer;
begin
  -- Un borrador todavía no es un documento: no gasta correlativo.
  if new.estado = 'borrador' then
    new.numero := null;
    new.codigo := null;
    return new;
  end if;

  if new.numero is null then
    -- La primera vez respeta el número declarado por el cliente, si lo hay.
    if not exists (select 1 from requisiciones where numero is not null) then
      select nullif(btrim(valor),'')::integer into ini
        from configuracion where clave = 'req_numero_inicial';
      if ini is not null and ini > 1 then
        perform setval('req_numero_seq', ini, false);
      end if;
    end if;
    new.numero := nextval('req_numero_seq');
  end if;
  new.codigo := 'REQ-' || lpad(new.numero::text, 5, '0');
  return new;
end $$;

drop trigger if exists trg_req_numero on public.requisiciones;
create trigger trg_req_numero before insert on public.requisiciones
for each row execute function public.req_set_numero();

-- Y cuando el borrador se envía, ahí sí recibe su número.
drop trigger if exists trg_req_numero_upd on public.requisiciones;
create trigger trg_req_numero_upd before update on public.requisiciones
for each row when (old.numero is null and new.estado <> 'borrador')
execute function public.req_set_numero();

-- ── 7. QUIÉN TIENE QUE FIRMAR ESTO ──────────────────────────────────────────
-- ⛔ FAIL-CLOSED: lo que no case con ninguna regla SUBE AL TOPE. Un permiso no se
--    gana por olvido. [[norma-no-estar-en-la-lista-no-es-candado]]
create or replace function public.req_quien_aprueba(
  p_monto numeric, p_categoria text default null, p_destino text default null
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare r record; tope text;
begin
  tope := coalesce(nullif(btrim((select valor from configuracion where clave='req_rol_tope')),''),
                   'directivo');

  -- 1) Las reglas del «sí o sí» ganan siempre, sin mirar el monto.
  for r in
    select * from req_reglas
     where activa and documento='requisitorio' and siempre
       and (categoria is null or categoria = p_categoria)
       and (destino   is null or destino   = p_destino)
     order by prioridad, created_at
  loop
    return json_build_object('rol', coalesce(r.aprueba_rol, tope),
                             'usuario', r.aprueba_usuario,
                             'regla', r.id, 'motivo', coalesce(r.nota,'Siempre requiere firma'));
  end loop;

  -- 2) Después, por monto. Sin monto todavía (recién pedido) no se decide acá:
  --    se resuelve otra vez cuando compras carga las ofertas.
  if p_monto is not null then
    for r in
      select * from req_reglas
       where activa and documento='requisitorio' and not siempre
         and (categoria    is null or categoria = p_categoria)
         and (destino      is null or destino   = p_destino)
         and (monto_desde  is null or p_monto >= monto_desde)
         and (monto_hasta  is null or p_monto <= monto_hasta)
       order by prioridad, created_at
    loop
      return json_build_object('rol', coalesce(r.aprueba_rol, tope),
                               'usuario', r.aprueba_usuario,
                               'regla', r.id, 'motivo', coalesce(r.nota,''));
    end loop;
  end if;

  -- 3) Nada casó → el tope. Nunca «no hace falta firma».
  return json_build_object('rol', tope, 'usuario', null, 'regla', null,
                           'motivo', 'Sin regla que aplique: decide el tope');
end $$;

-- ── 8. EL PEDIDO PARTIDO EN DOS ─────────────────────────────────────────────
-- La trampa clásica del límite: tres pedidos de US$ 45 el mismo día en vez de uno
-- de US$ 135, y ninguno pide firma. Si el sistema no los suma, poner un límite
-- EMPEORA el control en vez de mejorarlo.
create or replace view public.req_fraccionamiento as
select r.solicitante,
       r.fecha,
       coalesce(r.cam, r.area, r.destino)               as destino_real,
       count(*)                                          as pedidos,
       sum(coalesce(r.monto_aprobado_usd, r.monto_estimado_usd, 0)) as suma_usd,
       string_agg(r.codigo, ', ' order by r.numero)      as codigos
  from requisiciones r
 where r.estado not in ('anulada','rechazada','borrador')
   and r.fecha >= (now() at time zone 'America/Caracas')::date - 7
 group by 1,2,3
having count(*) > 1;

-- ── 9. SEGURIDAD ────────────────────────────────────────────────────────────
-- Mismo patrón que el resto: `app_rol()` y nada de `anon`.
alter table public.requisiciones    enable row level security;
alter table public.req_lineas       enable row level security;
alter table public.req_cotizaciones enable row level security;
alter table public.req_reglas       enable row level security;
alter table public.req_delegaciones enable row level security;

revoke all on public.requisiciones, public.req_lineas, public.req_cotizaciones,
              public.req_reglas, public.req_delegaciones from anon;
grant select, insert, update, delete
  on public.requisiciones, public.req_lineas, public.req_cotizaciones,
     public.req_reglas, public.req_delegaciones to authenticated;
grant select on public.req_fraccionamiento to authenticated;
revoke all on public.req_fraccionamiento from anon;

-- Pedir: cualquiera que tenga rol conocido. El que ve la falla es el que pide.
do $$
declare t text;
begin
  foreach t in array array['requisiciones','req_lineas','req_cotizaciones'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_rol() is not null)', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app_rol() is not null)', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (app_rol() is not null) with check (app_rol() is not null)', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app_puede_borrar())', t||'_del', t);
  end loop;
end $$;

-- ⛔ Las REGLAS y las DELEGACIONES no las toca quien pide. Si el que pide puede
--    cambiar quién aprueba, no hay aprobación.
do $$
declare t text;
begin
  foreach t in array array['req_reglas','req_delegaciones'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_rol() is not null)', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format($f$create policy %I on public.%I for insert to authenticated with check (app_rol() = any (array['superadmin','directivo']))$f$, t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format($f$create policy %I on public.%I for update to authenticated using (app_rol() = any (array['superadmin','directivo'])) with check (app_rol() = any (array['superadmin','directivo']))$f$, t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app_puede_borrar())', t||'_del', t);
  end loop;
end $$;

-- ── 10. EL ENGANCHE CON LO QUE YA EXISTE ────────────────────────────────────
alter table public.ordenes_servicio add column if not exists req_id text;
create index if not exists ordenes_servicio_req_idx on public.ordenes_servicio(req_id);

alter table public.anomalias add column if not exists req_id text;
create index if not exists anomalias_req_idx on public.anomalias(req_id);

-- El interruptor de la regla dura, APAGADO. Se enciende cliente por cliente.
insert into configuracion (clave, valor)
select 'req_obliga_orden', 'false'
where not exists (select 1 from configuracion where clave = 'req_obliga_orden');

-- Cómo llamarlo en la pantalla. Tony Gas dice «Requisitorio»; otro cliente dirá
-- «Solicitud de compra». El mecanismo se replica, la palabra la pone la empresa.
insert into configuracion (clave, valor)
select 'req_etiqueta', 'Requisitorio'
where not exists (select 1 from configuracion where clave = 'req_etiqueta');

insert into configuracion (clave, valor)
select 'req_rol_tope', 'directivo'
where not exists (select 1 from configuracion where clave = 'req_rol_tope');

-- ── 11. ¿ESTÁ LISTO PARA ENCENDERSE EN ESTA INSTANCIA? ────────────────────
-- ⛔ UN CANDADO QUE ROMPE LA HERRAMIENTA ES PEOR QUE NO TENER CANDADO.
-- Medido el 04/09/2026: FLOTILLA y VIDECA no tienen NINGÚN usuario con el rol
-- tope. Si allá se encendiera el requisitorio, todo subiría a firma y no habría
-- nadie que pueda firmar: el circuito quedaría trancado y la culpa parecería del
-- que pidió. Antes de encender el módulo en una instancia, esta función dice si
-- están puestas las piezas — y la auditoría diaria la puede llamar sola.
create or replace function public.req_listo()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare tope text; n_tope int; url text; n_compras int; faltan text[] := '{}';
begin
  tope := coalesce(nullif(btrim((select valor from configuracion where clave='req_rol_tope')),''),'directivo');
  select count(*) into n_tope   from btg_usuarios where rol = tope and coalesce(activo,true);
  select count(*) into n_compras from btg_usuarios where rol = 'compras' and coalesce(activo,true);
  url := btrim(coalesce((select valor from configuracion where clave='app_url'),''));

  if n_tope = 0 then
    faltan := array_append(faltan, 'nadie tiene el rol tope «'||tope||'»: no habría quién firme');
  end if;
  if url = '' then
    faltan := array_append(faltan, 'falta configuracion.app_url: el enlace de la firma no se puede armar');
  end if;
  if n_compras = 0 then
    faltan := array_append(faltan, 'nadie tiene el rol «compras»: cotizar caería en admin, sin dejar rastro de quién');
  end if;

  return json_build_object(
    'listo', cardinality(faltan) = 0,
    'candado_encendido', coalesce((select valor from configuracion where clave='req_obliga_orden'),'false') = 'true',
    'rol_tope', tope, 'personas_en_el_tope', n_tope,
    'personas_en_compras', n_compras,
    'app_url', case when url='' then null else url end,
    'falta', faltan
  );
end $$;
