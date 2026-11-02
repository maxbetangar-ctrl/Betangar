-- ═══════════════════════════════════════════════════════════════════════════
-- COMPROBANTES DE RETENCIÓN — correlativo fiscal y número emitido
-- 02/11/2026
--
-- Para que Betangar emita los comprobantes que hoy hace GALAC hacen falta dos
-- cosas que no existían: dónde guardar el número que se le dio a cada factura,
-- y un correlativo que NO se pueda repetir.
--
-- ⛔ EL CORRELATIVO NO SE ASIGNA EN EL NAVEGADOR. Dos personas emitiendo a la
--    vez leerían el mismo «último» y emitirían dos comprobantes con el mismo
--    número. Un número fiscal repetido no se arregla después: ya salió. Por eso
--    el que reparte es la base, con un UPDATE ... RETURNING, que bloquea la fila.
--
-- ⛔ NO ARRANCA EN 1. GALAC ya emitió hasta IVA 632 e ISLR 201 (ambos 10/2026),
--    medido sobre los comprobantes reales. Dos series para el mismo RIF es un
--    problema fiscal: esto CONTINÚA la numeración de GALAC.
--
-- Formatos, medidos sobre los comprobantes de Betangar:
--    IVA   AAAAMM + 8  dígitos  →  20260900000571
--    ISLR  AAAAMM + 10 dígitos  →  2026100000000199
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Dónde queda escrito el número que se le dio a cada factura ──────────────
alter table cxp_facturas add column if not exists comp_iva        text;
alter table cxp_facturas add column if not exists comp_iva_fecha  text;
alter table cxp_facturas add column if not exists comp_islr       text;
alter table cxp_facturas add column if not exists comp_islr_fecha text;

comment on column cxp_facturas.comp_iva  is 'Nº del comprobante de retención de IVA emitido. Si está puesto, ya se emitió: no se vuelve a pedir número.';
comment on column cxp_facturas.comp_islr is 'Nº del comprobante de retención de ISLR emitido.';

-- Un número no puede estar en dos facturas. Es la red de seguridad por si algo
-- se saltara la función.
create unique index if not exists cxp_facturas_comp_iva_unico
  on cxp_facturas (comp_iva)  where comp_iva  is not null;
create unique index if not exists cxp_facturas_comp_islr_unico
  on cxp_facturas (comp_islr) where comp_islr is not null;

-- 2. El contador ────────────────────────────────────────────────────────────
create table if not exists retencion_correlativos (
  tipo        text primary key check (tipo in ('IVA','ISLR')),
  ultimo      bigint not null default 0,
  nota        text,
  actualizado timestamptz not null default now()
);

alter table retencion_correlativos enable row level security;

-- Se siembra con lo ÚLTIMO que emitió GALAC. Si ya existe, no se toca: volver a
-- correr la migración no puede retroceder un correlativo fiscal.
insert into retencion_correlativos (tipo, ultimo, nota)
select 'IVA', 632, 'Último de GALAC: 20261000000632 (10/2026)'
where not exists (select 1 from retencion_correlativos where tipo = 'IVA');

insert into retencion_correlativos (tipo, ultimo, nota)
select 'ISLR', 201, 'Último de GALAC: 2026100000000201 (10/2026)'
where not exists (select 1 from retencion_correlativos where tipo = 'ISLR');

-- 3. Quien reparte los números ──────────────────────────────────────────────
-- p_periodo es el período fiscal 'AAAA-MM' de la FACTURA, no el día de hoy: el
-- comprobante pertenece al período en que se hizo la retención.
create or replace function ret_siguiente_comprobante(p_tipo text, p_periodo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n     bigint;
  v_largo int;
begin
  if p_tipo not in ('IVA','ISLR') then
    raise exception 'tipo de retención desconocido: %', p_tipo;
  end if;
  if p_periodo !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'el período fiscal debe venir como AAAA-MM, llegó: %', p_periodo;
  end if;

  -- UPDATE ... RETURNING bloquea la fila: dos emisiones simultáneas se ponen en
  -- fila y cada una se lleva un número distinto.
  update retencion_correlativos
     set ultimo = ultimo + 1, actualizado = now()
   where tipo = p_tipo
  returning ultimo into v_n;

  if v_n is null then
    raise exception 'el correlativo % no está dado de alta', p_tipo;
  end if;

  v_largo := case when p_tipo = 'ISLR' then 10 else 8 end;
  return replace(p_periodo, '-', '') || lpad(v_n::text, v_largo, '0');
end;
$$;

-- ⛔ Toda función nace abierta a public: hay que cerrarla a mano.
revoke all on function ret_siguiente_comprobante(text, text) from public;
revoke all on function ret_siguiente_comprobante(text, text) from anon;
grant execute on function ret_siguiente_comprobante(text, text) to authenticated;

-- La tabla no se toca desde el navegador: sólo la función reparte.
revoke all on table retencion_correlativos from anon;
revoke all on table retencion_correlativos from authenticated;
grant select on table retencion_correlativos to authenticated;
