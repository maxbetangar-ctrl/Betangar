-- ════════════════════════════════════════════════════════════════════════════
-- EL MES DE ARRANQUE: los gastos que se pagaron ANTES de que existiera la cuenta
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUE EXISTE (21/10/2026, pedido de Maximo):
--
-- Entre el 20/02 y el 16/03/2026 hubo 46 gastos que NO estan en `bnc_movimientos`
-- y nunca lo van a estar: el estado de cuenta del BNC **empieza el 23/03** y esa
-- plata la pusieron los socios de su bolsillo. La propia hoja de la que salen
-- («RELC GASTOS BTG» del respaldo de contabilidad) lo dice al final: TOTAL, menos
-- lo que puso JONAS, y el resto DIVIDIDO ENTRE DOS. Es una cuadratura entre
-- socios, no un estado de cuenta.
--
-- ⛔ POR QUE NO VAN AL BANCO NI AL COSTO POR TONELADA:
--
--  1. Meterlos en `bnc_movimientos` ROMPERIA LA CONCILIACION: ese saldo tiene que
--     seguir cuadrando con el banco de verdad, y estos pagos nunca salieron de
--     esa cuenta.
--
--  2. De los US$ 21.967, **solo US$ 2.657 son costo de mover una tonelada**. El
--     resto es ARRANQUE: traer los 10 camiones desde Merida, las antenas
--     Starlink, los GPS, el software GALAC, acondicionar el galpon. Se pago UNA
--     VEZ para poder operar. Sumarlo al costo por tonelada seria meter el
--     traslado de los camiones en el precio de un viaje.
--
--  3. Y aunque se cargara solo lo operativo, marzo **no tiene cuota de camiones**
--     (la primera vence el 01/04) ni gastos fijos. Esas 1.624 toneladas entrarian
--     pagando solo gasoil y nomina, y el costo bajaria de 16,42 a 15,97 por una
--     razon falsa. [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
-- 🔒 EL SEGURO ES ESTRUCTURAL, NO UNA PROMESA: `btg_estado_financiero` lee
--    UNICAMENTE de `bnc_movimientos`. Mientras esta tabla no se nombre ahi, no
--    puede ensuciar el costo. Al final de este archivo hay una asercion que lo
--    COMPRUEBA y revienta si alguien los conecta.
--    [[norma-probar-el-camino-no-la-pieza]]
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.btg_arranque_gastos (
  id          bigint generated always as identity primary key,
  item        integer,
  fecha       date,                    -- NULL de verdad: 5 filas del Excel dicen «S/I»
  proveedor   text,
  concepto    text,
  bs          numeric not null default 0,
  usd_directo numeric not null default 0,   -- lo que ya estaba en US$ en la hoja
  tasa        numeric,                 -- BCV del dia; NULL si la fila no tiene fecha
  usd_total   numeric not null,        -- usd_directo + bs/tasa, a la tasa de SU dia
  clase       text not null,
  subclase    text,
  observacion text,
  origen      text not null,
  created_at  timestamptz not null default now(),

  -- ⛔ Un texto libre en `clase` convierte el resumen en basura: si alguien
  --    escribe 'operativos' en plural, ese gasto desaparece de los dos totales
  --    y nadie lo nota. [[norma-la-falta-de-un-dato-no-es-un-dato]]
  constraint btg_arranque_clase_valida check (clase in
    ('operativo',        -- gasoil, nomina, dotacion: SI es costo de mover
     'arranque',         -- traer los camiones, equiparlos, el galpon, el software
     'relaciones',       -- atenciones y reembolsos sin desglose
     'sin_identificar')) -- ⛔ el Excel no dice que es. NO se inventa.
);

-- Cargar dos veces el mismo respaldo duplicaria los 46 gastos sin avisar.
create unique index if not exists btg_arranque_origen_item
  on public.btg_arranque_gastos (origen, item);

comment on table public.btg_arranque_gastos is
  'Gastos del arranque (20/02 - 16/03/2026), pagados por los socios ANTES de que '
  'existiera la cuenta del BNC. NO entran en bnc_movimientos ni en el costo por '
  'tonelada: la mayoria es inversion de una sola vez.';
comment on column public.btg_arranque_gastos.usd_total is
  'Valorado a la tasa BCV de SU PROPIO DIA, nunca a un promedio.';
comment on column public.btg_arranque_gastos.clase is
  'operativo = costo de mover una tonelada. arranque = inversion de una sola vez.';

-- ── QUIEN LO VE ─────────────────────────────────────────────────────────────
-- Son COSTOS. Se abren a los mismos que ya ven lo financiero y a nadie mas:
-- abrirselos a un supervisor le destapa la estructura de costos de la empresa.
alter table public.btg_arranque_gastos enable row level security;

drop policy if exists btg_arranque_lectura on public.btg_arranque_gastos;
create policy btg_arranque_lectura on public.btg_arranque_gastos
  for select using (app_rol() = any (array[
    'superadmin','admin','revisor','auditor','directivo']));

drop policy if exists btg_arranque_ins on public.btg_arranque_gastos;
create policy btg_arranque_ins on public.btg_arranque_gastos
  for insert with check (app_rol() = any (array['superadmin','admin'])
                         and not app_solo_lectura());

drop policy if exists btg_arranque_upd on public.btg_arranque_gastos;
create policy btg_arranque_upd on public.btg_arranque_gastos
  for update using (app_rol() = any (array['superadmin','admin'])
                    and not app_solo_lectura());

drop policy if exists btg_arranque_del on public.btg_arranque_gastos;
create policy btg_arranque_del on public.btg_arranque_gastos
  for delete using (app_rol() = 'superadmin'
                    and not app_exige_token() and not app_solo_lectura());

revoke all on public.btg_arranque_gastos from anon;
grant select, insert, update, delete on public.btg_arranque_gastos to authenticated;
grant all on public.btg_arranque_gastos to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- EL RESUMEN DEL MES DE ARRANQUE
-- ════════════════════════════════════════════════════════════════════════════
-- Junta las dos fuentes que tiene marzo, que son distintas y hay que no mezclar:
--   · esta tabla            → los gastos pagados por los socios
--   · `nomina_historial`    → las semanas de nomina, que SI estaban cargadas
--
-- ⛔ SEM-03 (16→22/03) NO se suma: la pago el banco el 26/03 y por lo tanto YA
--    esta dentro del costo del periodo. Se comprobo por NOMBRE Y MONTO, no por
--    el total: 12 choferes calzan exactos con SEM-03 contra 3 de SEM-04 y 1 de
--    SEM-02. [[norma-la-palabra-que-identifica-es-la-rara]]
create or replace function public.btg_arranque_resumen()
returns table (
  bloque      text,
  detalle     text,
  usd         numeric,
  entra_al_costo boolean,
  nota        text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.btg_ve_financiero_o_falla();

  return query
  -- los gastos de la relacion, por clase
  select 'GASTOS DE LOS SOCIOS'::text,
         g.clase || coalesce(' · ' || g.subclase, ''),
         round(sum(g.usd_total)::numeric, 2),
         (g.clase = 'operativo'),
         case g.clase
           when 'operativo' then 'gasoil, nomina y dotacion de los primeros dias'
           when 'arranque'  then 'inversion de una sola vez: no es costo por tonelada'
           when 'relaciones' then 'atenciones y reembolsos sin desglose'
           else 'el Excel no dice que es: NO se invento una categoria'
         end
    from public.btg_arranque_gastos g
   group by g.clase, g.subclase

  union all
  -- La nomina de las semanas anteriores al 23/03. La frontera NO es la fecha de
  -- la semana sino SI EL BANCO YA LA PAGO: SEM-03 termina el 22/03 pero se pago
  -- el 26/03, o sea DENTRO del periodo, y por eso NO vuelve a sumar.
  select 'NOMINA DE MARZO'::text,
         n.semana || ' · ' || n.periodo,
         round(n.total_usd::numeric, 2),
         (n.fecha_hasta < date '2026-03-16'),
         case when n.fecha_hasta < date '2026-03-16'
              then 'pagada antes del 23/03: nunca entro al estado de cuenta'
              else 'YA CONTADA: la pago el banco el 26/03, esta dentro del costo del periodo'
         end
    from public.nomina_historial n
   where n.fecha_hasta < date '2026-03-23';
end $$;

revoke all on function public.btg_arranque_resumen() from public, anon;
grant execute on function public.btg_arranque_resumen() to authenticated, service_role;

comment on function public.btg_arranque_resumen() is
  'Resumen del mes de arranque (feb-mar 2026). `entra_al_costo` dice si esa linea '
  'es costo de mover una tonelada o inversion de una sola vez.';


-- ════════════════════════════════════════════════════════════════════════════
-- 🔒 LA ASERCION: que esta tabla NUNCA toque el costo por tonelada
-- ════════════════════════════════════════════════════════════════════════════
-- Una promesa en un comentario no es un candado. Si alguien conecta esta tabla
-- al motor del costo, este bloque revienta la proxima migracion que se corra.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'btg_estado_financiero'
   limit 1;

  if d is null then
    raise exception '⛔ btg_estado_financiero no existe: la asercion no puede comprobar nada, '
                    'y una asercion que no comprueba nada afirma lo que no hace.';
  end if;

  if d ilike '%btg_arranque_gastos%' then
    raise exception '⛔ btg_estado_financiero quedo leyendo btg_arranque_gastos. '
                    'Eso mete la inversion de arranque (antenas, GPS, traer los camiones '
                    'de Merida) dentro del costo por tonelada. Revisar antes de seguir.';
  end if;
end $$;
