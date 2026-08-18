-- ════════════════════════════════════════════════════════════════════════════════════════
-- MOTOR DE STOCK: EL SALDO LO LLEVA LA BASE, NO LA APP          2026-08-17
--
-- LO QUE REPORTÓ CARLOS (Flotilla, 17/08): «se agregaron 30 litros el 10 de julio, hoy se
-- recibieron 36 más; cuando le digo agregar tengo que registrar de nuevo el artículo. Y cuando
-- voy a aplicar el uso de 15 litros no se despliega ningún artículo».
--
-- LA RAÍZ NO ERAN ESOS SÍNTOMAS. `inventario.stock` era un número suelto que la app pisaba a
-- mano (`item.stock -= cant`), e `inv_movimientos` una bitácora paralela que no lo sostenía.
-- Nada obligaba a que uno fuera la suma del otro, y ya había pasado factura:
--   · Flotilla: el ÚNICO movimiento (10/07) apunta a INV1783717253574, un ítem que ya no existe
--     — Carlos ya había recreado el artículo una vez. Y ese movimiento cierra en 31 mientras el
--     ítem vivo dice 30.
--   · Betangar: 23 de 26 ítems tienen stock que no se sostiene en ningún movimiento.
-- Un número que el dueño no puede explicar. Contar el stock sin poder mostrar de dónde salió
-- cada unidad no es un inventario: es una creencia.
--
-- LA REGLA QUE SE INSTALA — la misma que ya rige el odómetro y los correlativos:
--   EL SALDO ES LA SUMA DE LOS MOVIMIENTOS. No se escribe: se deduce.
--   Entrada y Apertura suman (cantidad > 0). Uso y Merma restan (cantidad < 0).
--
-- POR QUÉ ESTO MATA LOS CUATRO SÍNTOMAS POR CONSTRUCCIÓN Y NO POR PARCHE:
--   · recrear el artículo → lo impide un UNIQUE sobre el nombre normalizado;
--   · histórico huérfano → lo impide una FK real (y no se puede borrar un ítem con historia);
--   · «no aparece nada en el selector» → la pantalla ya no puede tener una lista propia:
--     lee la de la base, que es la única que existe;
--   · la fecha y los decimales → dejan de ser opcionales porque el MOVIMIENTO es la unidad de
--     registro, y lleva su fecha y su `numeric` desde el principio.
--
-- SEGURIDAD DEL DATO EXISTENTE: nadie pierde stock. Antes de encender el motor se siembra un
-- movimiento de APERTURA por cada ítem cuyo saldo no cuadre, con la diferencia exacta. Betangar
-- conserva sus 64 unidades y queda con su apertura documentada y fechada.
-- ════════════════════════════════════════════════════════════════════════════════════════

begin;

-- ── 0 · Columnas que faltaban para poder archivar en vez de borrar ──────────────────────────
alter table public.inventario add column if not exists activo boolean not null default true;
alter table public.inventario add column if not exists nota text;

-- ── 0.b · EL TIPO DEL SALDO: numeric, nunca integer ─────────────────────────────────────────
-- Lo encontró la prueba del camino completo, no la lectura del código: en `flotamax-demo` estas
-- dos columnas eran `integer`, y un uso de 15,5 L sobre 66 dejaba 51 en vez de 50,5 — el saldo
-- se redondeaba solo y quedaba descuadrado contra su propio historial. Las otras tres bases ya
-- eran `numeric`; esa había quedado atrás. Un aceite se mide en litros y medio: si el tipo no lo
-- admite, no hay app que lo salve. Va acá para que ninguna instancia pueda quedar distinta.
alter table public.inventario       alter column stock        type numeric using stock::numeric;
alter table public.inventario       alter column stock_min    type numeric using stock_min::numeric;
alter table public.inv_movimientos  alter column cantidad     type numeric using cantidad::numeric;
alter table public.inv_movimientos  alter column stock_result type numeric using stock_result::numeric;

comment on column public.inventario.stock is
  'SALDO CALCULADO: lo mantiene el trigger trg_inv_saldo desde inv_movimientos. NO se escribe desde la app: cualquier UPDATE directo lo pisa el recálculo.';

-- ── 1 · LOS HUÉRFANOS NO SE BORRAN: SE LES DEVUELVE SU ÍTEM ─────────────────────────────────
-- Un movimiento que apunta a un ítem inexistente es historia real de la empresa: alguien compró
-- algo y lo pagó. Borrarlo para que la FK entre sería tapar el problema con el problema.
-- Se recupera el ítem con el nombre que el propio movimiento traía, ARCHIVADO y en 0: así el
-- histórico vuelve a colgar de algo verificable, y si resulta ser el mismo ítem que uno vivo,
-- fusionarlos es una decisión de negocio que toma una persona, no la adivina una migración.
-- ⚠️ Nace con el SALDO DE SUS PROPIOS MOVIMIENTOS, no en cero. Si naciera en cero, el paso 2 le
-- calcularía una apertura NEGATIVA (0 menos lo que ya suma) y el candado de signo del paso 3
-- rechazaría la fila, abortando la migración entera. El saldo de un ítem es la suma de su
-- historia también el día que se lo recupera.
insert into public.inventario (id, nombre, categoria, unidad, stock, stock_min, precio, activo, nota)
select distinct on (m.item_id)
       m.item_id,
       coalesce(nullif(btrim(m.item),''), 'Item recuperado ' || m.item_id),
       'Repuestos varios', 'Unidades',
       (select coalesce(sum(x.cantidad),0) from public.inv_movimientos x where x.item_id = m.item_id),
       0, coalesce(m.precio,0), false,
       'RECUPERADO 2026-08-17: tenia movimientos pero el item no existia (se habia recreado el articulo). Revisar si es el mismo que un item activo y fusionarlos.'
  from public.inv_movimientos m
 where m.item_id is not null
   and not exists (select 1 from public.inventario i where i.id = m.item_id)
 order by m.item_id, m.fecha nulls last;

-- ── 2 · APERTURA: el saldo de hoy queda EXPLICADO antes de encender el motor ────────────────
-- Sin esto, encender el trigger pondría en cero los 23 ítems de Betangar que hoy tienen stock
-- sin movimientos. La apertura no inventa: registra que a esta fecha había tanto, y de ahí en
-- adelante todo movimiento es trazable.
-- El tipo lo decide el SIGNO de la diferencia: si al ítem le faltaba respaldo es 'Apertura'
-- (suma); si el ítem mostraba MENOS de lo que su historia dice, es un 'Ajuste' (resta). Forzar
-- todo a 'Apertura' rompería el candado de signo y, peor, escondería que ahí faltaba mercancía.
insert into public.inv_movimientos (id, fecha, item, item_id, tipo, cantidad, motivo, stock_result, created_at)
select 'IMAP' || i.id,
       current_date,
       i.nombre,
       i.id,
       case when i.stock - coalesce(s.suma, 0) > 0 then 'Apertura' else 'Ajuste' end,
       i.stock - coalesce(s.suma, 0),
       case when i.stock - coalesce(s.suma, 0) > 0
            then 'Saldo de apertura al pasar el stock a la base (2026-08-17). Es lo que habia contado hasta aca sin respaldo de movimientos.'
            else 'Ajuste de apertura (2026-08-17): el item mostraba MENOS de lo que suma su historial. Revisar por que.'
       end,
       i.stock,
       now()
  from public.inventario i
  left join (select item_id, sum(cantidad) suma
               from public.inv_movimientos group by item_id) s on s.item_id = i.id
 where i.stock is distinct from coalesce(s.suma, 0)
   and not exists (select 1 from public.inv_movimientos x where x.id = 'IMAP' || i.id);

-- ── 3 · CANDADOS: lo que no puede volver a pasar ────────────────────────────────────────────
-- Un movimiento SIEMPRE cuelga de un ítem que existe.
alter table public.inv_movimientos alter column item_id set not null;
alter table public.inv_movimientos drop constraint if exists fk_inv_mov_item;
alter table public.inv_movimientos
  add constraint fk_inv_mov_item foreign key (item_id)
  references public.inventario(id) on update cascade on delete restrict;

-- Un ítem con historia NO se borra (lo impide el `on delete restrict`). Se archiva: activo=false.

-- El mismo repuesto no se carga dos veces. Normalizado: sin mayúsculas, sin dobles espacios,
-- sin acentos, de modo que «Aceite Motor Diesel  Sae 20w50» y «aceite motor diesel sae 20w50»
-- son el mismo item y el segundo no entra.
create or replace function public.inv_nombre_norm(t text)
returns text language sql immutable as $fn$
  select translate(lower(btrim(regexp_replace(coalesce(t,''), '\s+', ' ', 'g'))),
                   'áéíóúüñ', 'aeiouun');
$fn$;
create unique index if not exists uq_inventario_nombre_norm
  on public.inventario (public.inv_nombre_norm(nombre)) where activo;

-- Una cantidad de cero no es un movimiento.
alter table public.inv_movimientos drop constraint if exists ck_inv_mov_cantidad;
alter table public.inv_movimientos add constraint ck_inv_mov_cantidad check (cantidad <> 0);

-- El signo lo manda el tipo, para que sumar sea siempre correcto y nadie pueda registrar una
-- salida en positivo (que inflaría el stock en vez de bajarlo).
alter table public.inv_movimientos drop constraint if exists ck_inv_mov_signo;
alter table public.inv_movimientos add constraint ck_inv_mov_signo check (
  (tipo in ('Entrada','Apertura','Devolucion','Devolución') and cantidad > 0) or
  (tipo in ('Uso','Merma','Ajuste')                         and cantidad < 0) or
  (tipo is null)
);

-- Una fecha futura no es un movimiento que ya ocurrió (+1 día de gracia por la zona horaria).
alter table public.inv_movimientos drop constraint if exists ck_inv_mov_fecha;
alter table public.inv_movimientos add constraint ck_inv_mov_fecha
  check (fecha is null or fecha <= (current_date + 1));

-- ── 4 · EL MOTOR: el saldo se recalcula solo ────────────────────────────────────────────────
-- Recalcula por SUMA, no por delta: un delta acumula el error de cualquier fila que se corrija
-- o se borre después, y volvería a producir exactamente el descuadre que esto viene a cerrar.
create or replace function public.inv_recalcular_saldo(p_item text)
returns numeric language plpgsql security definer set search_path to 'public' as $fn$
declare v numeric;
begin
  select coalesce(sum(cantidad),0) into v from public.inv_movimientos where item_id = p_item;
  update public.inventario set stock = v where id = p_item;
  return v;
end $fn$;

create or replace function public.inv_saldo_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op in ('INSERT','UPDATE') and new.item_id is not null then
    perform public.inv_recalcular_saldo(new.item_id);
  end if;
  if tg_op in ('UPDATE','DELETE') and old.item_id is not null
     and (tg_op = 'DELETE' or old.item_id is distinct from new.item_id) then
    perform public.inv_recalcular_saldo(old.item_id);
  end if;
  return null;
end $fn$;

drop trigger if exists trg_inv_saldo on public.inv_movimientos;
create trigger trg_inv_saldo
  after insert or update or delete on public.inv_movimientos
  for each row execute function public.inv_saldo_trg();

-- ── 5 · LA PUERTA ÚNICA ─────────────────────────────────────────────────────────────────────
-- Había DOS caminos para mover stock —Compras/órdenes e Inventario— y valoraban distinto el
-- mismo estante. Ahora los dos entran por acá, así que no pueden divergir nunca más.
-- Quien llama dice CUÁNTO y QUÉ hizo; el signo, el saldo y la validación los pone la base.
create or replace function public.inv_movimiento_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_item   text := p->>'item_id';
  v_tipo   text := coalesce(nullif(p->>'tipo',''),'Uso');
  v_cant   numeric := coalesce(nullif(p->>'cantidad','')::numeric, 0);
  v_fecha  date := coalesce(nullif(p->>'fecha','')::date, current_date);
  v_precio numeric := nullif(p->>'precio','')::numeric;
  v_id     text := coalesce(nullif(p->>'id',''), 'IM' || (extract(epoch from clock_timestamp())*1000)::bigint);
  v_nombre text; v_unidad text; v_saldo numeric; v_activo boolean;
begin
  select nombre, unidad, stock, activo into v_nombre, v_unidad, v_saldo, v_activo
    from public.inventario where id = v_item;
  if v_nombre is null then
    return jsonb_build_object('ok', false, 'error', 'Ese item no existe en el inventario.');
  end if;
  if not v_activo then
    return jsonb_build_object('ok', false, 'error', 'Ese item esta archivado: no se le puede mover stock.');
  end if;
  if v_cant = 0 then
    return jsonb_build_object('ok', false, 'error', 'La cantidad no puede ser cero.');
  end if;
  if v_fecha > current_date + 1 then
    return jsonb_build_object('ok', false, 'error', 'Esa fecha todavia no llego.');
  end if;
  if v_tipo in ('Uso','Merma','Ajuste') then v_cant := -abs(v_cant); else v_cant := abs(v_cant); end if;
  if v_tipo in ('Uso','Merma') and (v_saldo + v_cant) < 0 then
    return jsonb_build_object('ok', false, 'error',
      'No alcanza: hay ' || v_saldo || ' ' || coalesce(v_unidad,'') || ' y estas sacando ' || abs(v_cant) || '.');
  end if;

  insert into public.inv_movimientos
    (id, fecha, item, item_id, tipo, cantidad, cam, motivo, factura, foto_url, precio,
     orden_id, mant_id, garantia_hasta, stock_result, created_at)
  values
    (v_id, v_fecha, v_nombre, v_item, v_tipo, v_cant, nullif(p->>'cam',''), nullif(p->>'motivo',''),
     nullif(p->>'factura',''), nullif(p->>'foto_url',''), v_precio, nullif(p->>'orden_id',''),
     nullif(p->>'mant_id',''), nullif(p->>'garantia_hasta','')::date, 0, now());

  -- El trigger ya dejó el saldo real; se LEE de ahí y no de una cuenta hecha acá.
  select stock into v_saldo from public.inventario where id = v_item;
  update public.inv_movimientos set stock_result = v_saldo where id = v_id;
  -- El precio del ítem sigue el ÚLTIMO de compra (decisión ya tomada en Compras/órdenes).
  if v_precio is not null and v_tipo in ('Entrada','Apertura') then
    update public.inventario set precio = v_precio where id = v_item;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'stock', v_saldo, 'item', v_nombre, 'unidad', v_unidad);
end $fn$;

-- ── 6 · ALTA DE ÍTEM: el stock inicial ENTRA COMO MOVIMIENTO, no como número en la ficha ────
create or replace function public.inv_item_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_id     text := coalesce(nullif(p->>'id',''), 'INV' || (extract(epoch from clock_timestamp())*1000)::bigint);
  v_nombre text := btrim(coalesce(p->>'nombre',''));
  v_ini    numeric := coalesce(nullif(p->>'stock_inicial','')::numeric, 0);
  v_precio numeric := coalesce(nullif(p->>'precio','')::numeric, 0);
  v_dup    text;
begin
  if v_nombre = '' then
    return jsonb_build_object('ok', false, 'error', 'Falta el nombre del item.');
  end if;
  select nombre into v_dup from public.inventario
   where activo and public.inv_nombre_norm(nombre) = public.inv_nombre_norm(v_nombre) limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'duplicado', true, 'error',
      'Ya existe "' || v_dup || '". Si llego mas de lo mismo, cargalo como ENTRADA de ese item: asi el historico queda en uno solo.');
  end if;

  insert into public.inventario (id, nombre, categoria, unidad, stock, stock_min, precio, activo)
  values (v_id, v_nombre, nullif(p->>'categoria',''), coalesce(nullif(p->>'unidad',''),'Unidades'),
          0, coalesce(nullif(p->>'stock_min','')::numeric, 2), v_precio, true);

  if v_ini > 0 then
    perform public.inv_movimiento_registrar(jsonb_build_object(
      'item_id', v_id, 'tipo', 'Apertura', 'cantidad', v_ini, 'precio', v_precio,
      'fecha', nullif(p->>'fecha',''), 'factura', nullif(p->>'factura',''),
      'motivo', 'Stock inicial al dar de alta el item'));
  end if;

  return jsonb_build_object('ok', true, 'id', v_id,
    'stock', (select stock from public.inventario where id = v_id));
end $fn$;

-- ── 7 · ARCHIVAR EN VEZ DE BORRAR ───────────────────────────────────────────────────────────
-- Borrar un ítem con historia dejaría de nuevo movimientos sin dueño: es justo lo que pasó.
create or replace function public.inv_item_archivar(p_id text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_n int;
begin
  select count(*) into v_n from public.inv_movimientos where item_id = p_id;
  if v_n = 0 then
    delete from public.inventario where id = p_id;
    return jsonb_build_object('ok', true, 'borrado', true);
  end if;
  update public.inventario
     set activo = false,
         nota = coalesce(nota,'') || ' | ARCHIVADO ' || current_date || coalesce(': ' || p_motivo,'')
   where id = p_id;
  return jsonb_build_object('ok', true, 'archivado', true, 'movimientos', v_n);
end $fn$;

revoke all on function public.inv_movimiento_registrar(jsonb) from public, anon;
revoke all on function public.inv_item_crear(jsonb)            from public, anon;
revoke all on function public.inv_item_archivar(text, text)    from public, anon;
grant execute on function public.inv_movimiento_registrar(jsonb) to authenticated;
grant execute on function public.inv_item_crear(jsonb)            to authenticated;
grant execute on function public.inv_item_archivar(text, text)    to authenticated;
grant execute on function public.inv_nombre_norm(text)            to authenticated, anon;

commit;

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────────────────────
-- Que dé cero no prueba nada si no probamos antes que el control DETECTA. Control positivo:
--   1) el saldo cuadra en todos:
--      select count(*) from public.inventario i
--        left join (select item_id, sum(cantidad) s from public.inv_movimientos group by item_id) m
--          on m.item_id = i.id
--       where i.stock is distinct from coalesce(m.s,0);                        -- debe dar 0
--   2) el candado MUERDE (las tres deben FALLAR):
--      insert into public.inv_movimientos(id,item_id,tipo,cantidad) values('X','NO_EXISTE','Uso',-1);
--      insert into public.inv_movimientos(id,item_id,tipo,cantidad) values('X',<id real>,'Uso',5);
--      delete from public.inventario where id = <id con movimientos>;
--   3) el motor CALCULA:
--      select public.inv_movimiento_registrar(jsonb_build_object('item_id',<id>,'tipo','Entrada','cantidad',36,'precio',9.37,'fecha','2026-08-17','factura','X-1'));
--      -- y el stock del ítem debe haber subido 36 sin que nadie lo escribiera.
