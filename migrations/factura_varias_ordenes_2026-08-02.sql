-- ════════════════════════════════════════════════════════════════════════════
-- UNA FACTURA PUEDE CUBRIR VARIAS ÓRDENES   (2026-08-02)   proyecto hrkjddehqnzcqwlkklqm
--
-- CAUSA (reporte de Máximo, 02/08/2026):
--   «Yo emito las órdenes y pasan a Cuentas por Pagar, pero no quiere decir que cada
--    orden sea una factura: algunas empresas acumulan varias órdenes y me hacen UNA
--    factura por varias. Incluso puedo deber 10 órdenes y si solo tengo para pagar 5,
--    me facturan las 5 que YO escojo y las otras 5 quedan en deuda.»
--
--   La base estaba clavada al revés: `cxp.orden_id` = UNA orden por deuda, y
--   `cxp_facturas.cxp_id` = UNA deuda por factura. Es decir, el sistema soportaba
--   «una orden partida en varias facturas» y NO «varias órdenes en una factura».
--   Sin esto había dos salidas y las dos estaban mal:
--     (a) cargar la factura entera contra UNA de las deudas → esa deuda se tragaba
--         plata de trabajos ajenos y las otras quedaban abiertas para siempre;
--     (b) partir la factura en N cargas → N filas con el MISMO número de factura en el
--         libro de compras y las retenciones al SENIAT emitidas en pedazos.
--
-- ARREGLO: `cxp_facturas` pasa a ser la CABECERA (1 fila = 1 factura real del proveedor,
--   que es lo que exige el libro de compras) y las nuevas LÍNEAS dicen cuánto de esa
--   factura corresponde a cada deuda/orden. Una deuda puede entrar COMPLETA o EN PARTE
--   (el proveedor a veces factura parte del trabajo ahora y el resto después).
--
-- MIGRACIÓN PURAMENTE ADITIVA: no toca `cxp` ni `cxp_facturas` ni sus datos. Las
--   facturas que ya existen quedan con UNA línea (su propia deuda, por su monto
--   completo), que es exactamente lo que significan hoy → el código nuevo lee lo
--   mismo que leía el viejo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla de líneas ──────────────────────────────────────────────────────
-- El tipo de `cxp_facturas.id` se detecta solo (uuid / bigint / text): si se escribiera
-- a mano y no coincidiera, la FK reventaría la migración entera.
do $$
declare tipo_fac text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_fac
    from pg_attribute a
   where a.attrelid = 'public.cxp_facturas'::regclass
     and a.attname  = 'id' and a.attnum > 0;
  if tipo_fac is null then
    raise exception 'No encontré public.cxp_facturas.id — ¿la tabla existe?';
  end if;

  execute format($f$
    create table if not exists public.cxp_factura_lineas (
      id           bigint generated always as identity primary key,
      factura_id   %s   not null references public.cxp_facturas(id) on delete cascade,
      cxp_id       text not null,          -- la deuda (una por orden) que cubre esta línea
      orden_id     text default '',        -- copia del nº de orden, para el impreso y la búsqueda
      base_bs      numeric not null default 0,
      iva_bs       numeric not null default 0,
      ret_iva_bs   numeric not null default 0,
      ret_islr_bs  numeric not null default 0,
      neto_bs      numeric not null default 0,
      tasa_val     numeric,                -- tasa del día de la factura (para pasar a $)
      creado_en    timestamptz default now(),
      constraint cxp_factura_lineas_unica unique (factura_id, cxp_id)
    )
  $f$, tipo_fac);
end $$;

-- Sin FK a `cxp` a propósito: borrar una deuda que ya está dentro de una factura no puede
-- llevarse la línea en silencio (la factura seguiría existiendo y dejaría de cuadrar).
-- El huérfano se ve; el borrado silencioso no.
create index if not exists idx_cxpfl_factura on public.cxp_factura_lineas(factura_id);
create index if not exists idx_cxpfl_cxp     on public.cxp_factura_lineas(cxp_id);
create index if not exists idx_cxpfl_orden   on public.cxp_factura_lineas(orden_id);

-- ── 2. RLS (norma: tabla nueva = revocar anon + política VERBO POR VERBO) ────
alter table public.cxp_factura_lineas enable row level security;
revoke all on public.cxp_factura_lineas from anon;
grant  all on public.cxp_factura_lineas to authenticated;

drop policy if exists cxpfl_sel on public.cxp_factura_lineas;
drop policy if exists cxpfl_ins on public.cxp_factura_lineas;
drop policy if exists cxpfl_upd on public.cxp_factura_lineas;
drop policy if exists cxpfl_del on public.cxp_factura_lineas;

create policy cxpfl_sel on public.cxp_factura_lineas for select to authenticated using (true);
create policy cxpfl_ins on public.cxp_factura_lineas for insert to authenticated with check (true);
create policy cxpfl_upd on public.cxp_factura_lineas for update to authenticated using (true) with check (true);
-- Borrar una línea mueve la deuda Y la retención del SENIAT: mismo candado que cxp_facturas.
create policy cxpfl_del on public.cxp_factura_lineas for delete to authenticated using (app_rol() = 'superadmin');

-- ── 3. Backfill: cada factura vieja = UNA línea con sus propios montos ───────
-- Idempotente (ON CONFLICT DO NOTHING): se puede volver a correr sin duplicar.
insert into public.cxp_factura_lineas
       (factura_id, cxp_id, orden_id, base_bs, iva_bs, ret_iva_bs, ret_islr_bs, neto_bs, tasa_val)
select f.id,
       f.cxp_id::text,
       coalesce(f.orden_id, '')::text,
       coalesce(f.base_bs,0),
       coalesce(f.iva_bs,0),
       coalesce(f.ret_iva_bs,0),
       coalesce(f.ret_islr_bs,0),
       coalesce(f.neto_bs,0),
       f.tasa_val
  from public.cxp_facturas f
 where f.cxp_id is not null
on conflict (factura_id, cxp_id) do nothing;

-- ── 4. Comprobación (correr después; debe dar 0 filas) ──────────────────────
-- Facturas sin ninguna línea = plata que el libro de compras ve pero ninguna deuda:
--   select f.id, f.nro_factura, f.prov_nombre, f.total_bs
--     from public.cxp_facturas f
--    where not exists (select 1 from public.cxp_factura_lineas l where l.factura_id = f.id);
--
-- Líneas cuya deuda ya no existe (huérfanas, ver nota del punto 1):
--   select l.* from public.cxp_factura_lineas l
--    where not exists (select 1 from public.cxp c where c.id = l.cxp_id);
