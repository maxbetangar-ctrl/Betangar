-- ════════════════════════════════════════════════════════════════════════════
--  LA ORDEN DE SERVICIO Y LA DE COMPRA LLEVAN QR DE VERIFICACIÓN
--
--  Norma (Máximo, 2026-07-28): el QR de verificación es parte de la marca; va en
--  todo documento que sale hacia un tercero, y qué contiene se define por
--  documento.
--
--  ⛔ POR QUÉ ACÁ IMPORTA MÁS DE LO QUE PARECE
--  Estos dos papeles salen de la oficina y llegan a manos de un taller o de un
--  proveedor, y **autorizan gastar plata de la empresa**. Sin nada que verificar:
--    · un taller puede enseñar una orden CANCELADA y cobrar el trabajo igual —
--      el papel impreso no se entera de que la orden se anuló en el sistema;
--    · cualquiera con una hoja parecida puede mandar a hacer un trabajo o a
--      comprar materiales por cuenta de la empresa.
--  Por eso lo que más pesa acá no es el monto: es el **ESTADO DE HOY**.
--
--  ⛔ EL CÓDIGO ES NUEVO Y AL AZAR, NO SE USA EL `id`.
--  El `id` de una orden es un sello de tiempo (`OS1783564756140`): quien tenga
--  uno puede adivinar los vecinos y ponerse a mirar órdenes ajenas. Un código
--  al azar no se adivina.
--
--  ⚠️ LO QUE **NO** SALE: las notas. Ahí queda el motivo de una cancelación y
--  cualquier comentario interno de la oficina — eso no se le muestra a quien
--  llega con el papel en la mano.
-- ════════════════════════════════════════════════════════════════════════════

-- Alfabeto sin O/0 ni I/1: este código se dicta por teléfono al taller.
create or replace function public.nuevo_codigo_orden()
returns text language sql volatile as $$
  select 'OS-' || string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1), '')
  from generate_series(1, 8)
$$;

alter table public.ordenes_servicio
  add column if not exists codigo_verificacion text;

-- Las órdenes ya emitidas también reciben el suyo: si se reimprimen, salen con QR.
update public.ordenes_servicio
   set codigo_verificacion = public.nuevo_codigo_orden()
 where codigo_verificacion is null;

alter table public.ordenes_servicio
  alter column codigo_verificacion set default public.nuevo_codigo_orden();

create unique index if not exists ordenes_servicio_codigo_verificacion_key
  on public.ordenes_servicio (codigo_verificacion);

-- ── La consulta pública ─────────────────────────────────────────────────────
drop function if exists public.verificar_orden_servicio(text);

create function public.verificar_orden_servicio(p_codigo text)
returns table (
  valida       boolean,
  documento    text,     -- Orden de servicio / Orden de compra
  numero       text,
  fecha        date,
  proveedor    text,     -- confirma que la orden era para ESE taller
  trabajo      text,     -- el ítem, o el tipo si no hay ítem
  unidades     jsonb,
  estado       text,     -- emitida / en_proceso / hecha / cancelada — LEÍDO HOY
  cancelada    boolean,
  fecha_cierre date,
  costo_usd    numeric   -- solo cuando ya se cerró
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    true,
    case when o.tipo_orden = 'compra' then 'Orden de compra' else 'Orden de servicio' end,
    o.id,
    o.fecha,
    o.proveedor,
    coalesce(nullif(btrim(o.item), ''), o.tipo_servicio),
    coalesce(o.cams, '[]'::jsonb),
    o.estado,
    o.estado = 'cancelada',
    o.fecha_cierre,
    -- El costo solo tiene sentido cuando el trabajo se cerró; antes es $0 y
    -- mostrarlo se leería como «este trabajo no cuesta nada».
    case when o.estado = 'hecha' then o.costo_usd end
  from public.ordenes_servicio o
  where o.codigo_verificacion = upper(btrim(p_codigo))
  limit 1
$$;

-- Pública a propósito: la gracia del QR es que el taller lo escanee ahí mismo.
-- Solo esta función — la tabla sigue cerrada para anon.
grant execute on function public.verificar_orden_servicio(text) to anon, authenticated, service_role;
