-- ════════════════════════════════════════════════════════════════════════════════════════
-- GASOIL DE UNA UNIDAD A OTRA.  2026-11-04
--
-- ⛔ POR QUÉ. Pedido urgente de Máximo (04/11/2026): Samuel, el Jefe de Operaciones, puede
--    registrar que sale gasoil DEL TANQUE hacia otro destino (planta eléctrica, préstamo),
--    pero no lo que de verdad hace falta: **cuando se le saca gasoil a una unidad para
--    echárselo a otra**.
--
-- ⛔ POR QUÉ UNA TABLA PROPIA Y NO `salidas_tanque`. Un trasvase entre unidades **NO TOCA EL
--    TANQUE**: el galpón no entrega ni recibe un litro. Meterlo ahí restaría del tanque algo
--    que nunca salió de él y el cuadre quedaría peor que sin registrarlo. Y tampoco es un
--    `gasoil` normal: el código de ahí trata todo lo que no es 'compra' como despacho DESDE
--    el tanque. Es exactamente el mismo razonamiento por el que el 18/08/2026 se creó
--    `salidas_tanque`: no había dónde anotarlo y el cuadre lo contaba como faltante.
--
-- ⛔ LO QUE ESTE MOVIMIENTO SIGNIFICA PARA LA AUDITORÍA: la unidad de ORIGEN tiene menos
--    combustible del que dicen sus surtidas, y la de DESTINO más. Sin esta fila, la de
--    origen aparece gastando de más y la de destino andando con combustible que nadie le
--    echó — y eso ya se vio: el 04/11 la auditoría de FLOTILLA marcó 5 cargas por encima de
--    la capacidad del tanque que «huelen a traslado sin marcar».
-- ════════════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.trasvases_unidad (
  id              text primary key,
  fecha           date not null,
  cam_origen      text not null,
  cam_destino     text not null,
  litros          numeric not null,
  nota            text,
  registrado_por  text,
  created_at      timestamptz not null default now(),
  -- ⛔ Que no se pueda registrar un trasvase de una unidad A SÍ MISMA: no es un movimiento,
  --    es un error de dedo, y guardado se lee como un traslado real que nunca pasó.
  constraint trasvase_no_a_si_misma check (cam_origen <> cam_destino),
  -- Un trasvase de 0 o negativo no es un dato: es una fila que ensucia la cuenta.
  constraint trasvase_litros_positivos check (litros > 0)
);

comment on table public.trasvases_unidad is
  'Gasoil que se le saca a UNA UNIDAD para echárselo a OTRA. No toca el tanque del galpón: '
  'es combustible que ya había salido. Para la auditoría, la unidad de origen tiene menos de '
  'lo que dicen sus surtidas y la de destino más.';

create index if not exists trasvases_unidad_fecha_idx on public.trasvases_unidad (fecha desc);

alter table public.trasvases_unidad enable row level security;

-- Los MISMOS permisos que `salidas_tanque`, medidos antes de escribir esto: leer todos,
-- escribir solo `operativo` y `superadmin`, y nunca en modo solo-lectura.
-- ⛔ Una tabla nueva con RLS y SIN policy falla EN SILENCIO: el insert da 401 y el select
--    devuelve `[]`, que se lee como «no hay nada». [[norma-toda-funcion-nace-abierta-a-public]]
drop policy if exists tu_sel on public.trasvases_unidad;
drop policy if exists tu_ins on public.trasvases_unidad;
drop policy if exists tu_upd on public.trasvases_unidad;
drop policy if exists tu_del on public.trasvases_unidad;

create policy tu_sel on public.trasvases_unidad for select using (true);
create policy tu_ins on public.trasvases_unidad for insert
  with check ((app_rol() = any (array['operativo','superadmin'])) and (not app_solo_lectura()));
create policy tu_upd on public.trasvases_unidad for update
  using ((app_rol() = any (array['operativo','superadmin'])) and (not app_solo_lectura()))
  with check ((app_rol() = any (array['operativo','superadmin'])) and (not app_solo_lectura()));
create policy tu_del on public.trasvases_unidad for delete
  using (app_puede_borrar() and (not app_solo_lectura()));

grant select, insert, update, delete on public.trasvases_unidad to anon, authenticated, service_role;

commit;

-- Control: la tabla existe, tiene RLS y sus cuatro policies.
select (select count(*) from pg_policies where tablename='trasvases_unidad') as policies,
       (select relrowsecurity from pg_class where relname='trasvases_unidad') as rls_activa,
       (select count(*) from public.trasvases_unidad) as filas;
