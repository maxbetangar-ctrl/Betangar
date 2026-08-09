-- ============================================================================
-- Betangar · LA POSICIÓN — dónde está la plata, qué nos deben y qué debemos
-- 2026-08-09.
--
-- POR QUÉ EXISTE
-- El estado de resultados dice si el período dio ganancia. No dice si la
-- empresa está bien. Un socio que ve «utilidad US$ 110.567» y no ve que hay
-- 3 cuotas VENCIDAS por US$ 68.767 está leyendo media película.
--
-- Estos datos NO salen del banco: los declaró Máximo (el fondo en dólares, el
-- Excel de amortización de los camiones). Por eso se guardan como DECLARADOS,
-- con quién lo dijo y cuándo — no se deducen ni se recalculan solos.
-- [[norma-documento-no-afirma-lo-que-nadie-declaro]]
--
-- ⚠️ Y por eso cada fila lleva `vigente_al`: un saldo de deuda es cierto en una
-- fecha. Mostrarlo sin decir de cuándo es, envejece mal y nadie se entera.
-- ============================================================================

create table if not exists btg_posicion (
  clave        text primary key,
  titulo       text not null,
  grupo        text not null,            -- ACTIVO | POR_COBRAR | DEUDA
  monto_usd    numeric not null,
  vigente_al   date not null,
  declarado_por text not null,
  nota         text,
  supuesto     boolean not null default false,   -- true = descansa en algo sin confirmar
  updated_at   timestamptz not null default now()
);

comment on table btg_posicion is
  'Lo que el banco NO puede decir: el fondo en dólares, la deuda de los camiones, lo que se ejecutó y no se facturó. Cada fila con la fecha en que era cierta y quién la declaró.';
comment on column btg_posicion.supuesto is
  'true = el número descansa en algo que nadie confirmó. Se muestra, pero MARCADO. Un supuesto presentado como hecho es como se asusta a un socio con un número inventado.';

insert into btg_posicion (clave, titulo, grupo, monto_usd, vigente_al, declarado_por, nota, supuesto) values
  -- ⛔ ESTE ES EL NÚMERO QUE HAY QUE REGISTRAR: 74.763, no 71.119.
  -- Máximo (09/08): «es importante que marques los 74, debe registrar que se tienen comprados
  -- 74 y pico». Los US$ 71.119 que calcula el estado financiero son SOLO lo comprado dentro del
  -- período que cubre el estado de cuenta (desde el 23/03). El total comprado es mayor porque el
  -- fondo ya venía con dólares de antes. Los dos números son correctos y responden preguntas
  -- distintas — y por eso hay que decir cuál es cuál, o el socio duda de su propio dato.
  ('divisas_compradas', 'Dólares COMPRADOS desde el inicio', 'ACTIVO',
   74763, '2026-07-30', 'Máximo (app de control del fondo)',
   'Reconcilia exacto: 71.119 comprados dentro del estado de cuenta + 6.000 con que abre el fondo (anteriores al 23/03) − 2.356 que se vendieron para nómina = 74.763. De esos, 48.318 ya se aplicaron a la deuda de los camiones y 26.445 siguen en el fondo.', false),

  ('fondo_divisas', 'De esos, lo que TODAVÍA queda (cuenta de Alejandro Castillo)', 'ACTIVO',
   26445, '2026-07-30', 'Máximo',
   'No es una bolsa aparte: es el remanente de los mismos US$ 74.763. Está en manos de una persona, no en una cuenta de la empresa.', false),

  ('divisas_a_deuda', 'De esos, lo ya aplicado a la deuda de los camiones', 'ACTIVO',
   48318, '2026-07-23', 'Máximo + Excel de amortización',
   '6 pagos entre el 15/06 y el 23/07. Los dólares los compra Auto Unión: se le pasan bolívares y ella los aplica a la deuda. Por eso en el banco dice «PAGO PARA CAMBIO DE MONEDA» y NO existe ningún movimiento que diga «pago del crédito»: son el mismo hecho.', false),

  ('deuda_camiones', 'Deuda por los 12 camiones — AUTO UNIÓN DC', 'DEUDA',
   373189.92, '2026-08-09', 'Excel de amortización',
   '12 camiones × US$ 65.000 = 780.000 · inicial 396.000 · financiado 384.000 al 12% en 18 cuotas de US$ 23.417,11. El deudor formal es TRANSPORTE ATLAS, aunque la plata sale de la cuenta de Betangar.', false),

  ('deuda_vencida', '⚠️ Cuotas VENCIDAS de los camiones', 'DEUDA',
   68767.53, '2026-08-09', 'Excel de amortización',
   '3 cuotas vencidas. La próxima vence el 01/09/2026.', false),

  ('fiel_638', 'Fiel cumplimiento 10% de la factura 000638', 'POR_COBRAR',
   2535.04, '2026-08-09', 'Cruce banco ↔ facturas',
   'Única pata sin cobrar de las 36 del período. La factura es del 05/08 y el fiel suele entrar 4-6 días después.', false),

  ('viajes_sin_facturar', 'Viajes EJECUTADOS y todavía no facturados', 'POR_COBRAR',
   565313, '2026-08-09', 'Cruce planillas ↔ facturas',
   '1.784 viajes × US$ 316,88. En Venezuela no se factura hasta el momento del pago por el diferencial cambiario, así que el trabajo hecho no queda documentado en ningún papel. Se factura el 42% de lo ejecutado y el acumulado nunca baja.', true)
on conflict (clave) do update
  set titulo=excluded.titulo, grupo=excluded.grupo, monto_usd=excluded.monto_usd,
      vigente_al=excluded.vigente_al, declarado_por=excluded.declarado_por,
      nota=excluded.nota, supuesto=excluded.supuesto, updated_at=now();

alter table btg_posicion enable row level security;
revoke all on btg_posicion from anon, public;
grant select, insert, update, delete on btg_posicion to authenticated;
do $$
begin
  drop policy if exists btg_rol_lectura on btg_posicion;
  drop policy if exists btg_rol_upd on btg_posicion;
  drop policy if exists btg_rol_ins on btg_posicion;
  drop policy if exists btg_rol_del on btg_posicion;
  create policy btg_rol_lectura on btg_posicion for select to authenticated
    using (app_rol() = any (array['superadmin','auditor','admin','operador','visualizador','directivo','demo_admin','demo_operador']));
  create policy btg_rol_ins on btg_posicion for insert to authenticated
    with check (app_rol() = any (array['superadmin','admin','auditor']));
  create policy btg_rol_upd on btg_posicion for update to authenticated
    using (app_rol() = any (array['superadmin','admin','auditor']))
    with check (app_rol() = any (array['superadmin','admin','auditor']));
  create policy btg_rol_del on btg_posicion for delete to authenticated
    using (app_rol() = any (array['superadmin','admin']) and not app_exige_token());
end $$;

-- ---------------------------------------------------------------------------
-- A DÓNDE SE FUE CADA DÓLAR. Un socio no necesita 23 renglones: necesita saber
-- qué se está comiendo la plata. Devuelve el peso de cada rubro sobre el gasto.
-- ---------------------------------------------------------------------------
create or replace function btg_donde_se_fue(p_desde text, p_hasta text)
returns table (concepto text, usd numeric, pct numeric)
language sql security definer set search_path = public as $$
  with e as (
    select concepto, sum(usd) usd from btg_estado_financiero(p_desde,p_hasta)
     where bloque in ('OPERACION','ADMINISTRACION','OBLIGACIONES','SOCIO')
     group by 1
  ), t as (select nullif(sum(usd),0) v from e)
  select e.concepto, round(e.usd,2), round((e.usd / (select v from t) * 100)::numeric,1)
    from e order by e.usd desc
$$;
revoke all on function btg_donde_se_fue(text,text) from anon, public;
grant execute on function btg_donde_se_fue(text,text) to authenticated;

comment on function btg_donde_se_fue is
  'Los rubros de gasto ordenados por peso. Es la respuesta a «¿qué me está comiendo la plata?», que es lo que un socio pregunta de verdad.';
