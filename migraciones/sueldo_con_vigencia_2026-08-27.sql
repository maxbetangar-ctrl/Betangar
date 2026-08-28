-- ═══════════════════════════════════════════════════════════════════════════════
-- EL SUELDO TIENE FECHA: un aumento rige de ahí en adelante y no toca lo ya pagado
--
-- ⛔ POR QUÉ. Máximo, 27/08: «los sueldos se van modificando, pueden haber aumentos
--    y cosas así, que afectan es de ahí en adelante — las nóminas pagadas se cierran».
--    Y el motivo de fondo: «si no hacemos ese módulo nos van a estar llamando para
--    todo». Cada cosa que el cliente no puede hacer solo se vuelve una llamada nuestra.
--
-- 🔴 LO QUE ESTABA MAL. `empleados.sueldo` es UN campo. Si en septiembre alguien pasa
--    de 150 a 180 y se pisa ese campo, la nómina de agosto —ya pagada— pasa a decir
--    180. No es que se vea raro: es que la historia cambia sola y nadie se entera,
--    porque el número viejo ya no existe en ningún lado.
--
-- ⇒ El sueldo deja de ser un dato y pasa a ser una LÍNEA DE TIEMPO. Cada monto vale
--   DESDE una fecha. Preguntar «cuánto gana Fulano» sin decir cuándo deja de tener
--   sentido, y esa es exactamente la pregunta que producía el error.
--
-- ⚠️ `empleados.sueldo` NO se borra: queda como el vigente HOY, que es lo que lee
--    media docena de pantallas. Lo mantiene el trigger de acá abajo, para que no haya
--    que acordarse de actualizarlo a mano.
--    [[norma-fuente-unica-datos]]
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.empleado_sueldos (
  id          bigserial primary key,
  empleado_id text not null references public.empleados(id) on delete cascade,
  monto_usd   numeric(12,2) not null check (monto_usd >= 0),
  forma_pago  text not null default 'fijo',
  -- ⛔ DESDE, no «fecha»: el nombre importa. `fecha` invita a leerlo como «cuándo lo
  --    cargué»; `desde` dice lo que es —a partir de cuándo rige— y eso es lo que
  --    decide qué nómina usa qué monto.
  desde       date not null,
  motivo      text,
  cargado_por text,
  creado_en   timestamptz not null default now(),
  -- ⚠️ Un solo monto por persona y fecha. Dos filas con el mismo `desde` harían que
  --    «el sueldo vigente» dependa del orden de lectura, que es la peor forma de
  --    equivocarse: da bien casi siempre.
  unique (empleado_id, desde)
);
create index if not exists ix_empleado_sueldos_busqueda on public.empleado_sueldos (empleado_id, desde desc);

-- ── CUÁNTO GANABA ESTA PERSONA EN ESTA FECHA ────────────────────────────────
-- ⚠️ Devuelve el último monto con `desde <= la fecha preguntada`. Si se pregunta por
--    una fecha ANTERIOR al primer sueldo cargado, devuelve NULL y no cero: cero es
--    un sueldo, NULL es «no se sabe», y confundirlos hace que una nómina vieja se
--    calcule en cero sin que nadie lo note.
create or replace function public.sueldo_vigente(p_empleado text, p_fecha date default current_date)
returns numeric language sql stable as $$
  select s.monto_usd
    from public.empleado_sueldos s
   where s.empleado_id = p_empleado and s.desde <= p_fecha
   order by s.desde desc
   limit 1;
$$;

-- ── EL VIGENTE DE HOY SE MANTIENE SOLO ──────────────────────────────────────
-- ⛔ Sin esto habría DOS lugares que dicen el sueldo y alguien tendría que acordarse
--    de sincronizarlos. Se sincroniza solo, y solo hacia un lado: el historial manda.
-- ⚠️ Solo se pisa `empleados.sueldo` si la fila que entra es la MÁS RECIENTE. Cargar
--    un aumento retroactivo de marzo no puede cambiar lo que la persona gana hoy.
create or replace function public.empleado_sueldo_al_dia()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hoy numeric; v_forma text;
begin
  select s.monto_usd, s.forma_pago into v_hoy, v_forma
    from public.empleado_sueldos s
   where s.empleado_id = coalesce(new.empleado_id, old.empleado_id)
     and s.desde <= current_date
   order by s.desde desc limit 1;
  update public.empleados
     set sueldo = coalesce(v_hoy, 0), forma_pago = coalesce(v_forma, forma_pago)
   where id = coalesce(new.empleado_id, old.empleado_id);
  return null;
end $$;

drop trigger if exists trg_empleado_sueldo_al_dia on public.empleado_sueldos;
create trigger trg_empleado_sueldo_al_dia
  after insert or update or delete on public.empleado_sueldos
  for each row execute function public.empleado_sueldo_al_dia();

alter table public.empleado_sueldos enable row level security;
grant select, insert, update, delete on public.empleado_sueldos to authenticated;
grant usage, select on sequence public.empleado_sueldos_id_seq to authenticated;
drop policy if exists p_empleado_sueldos on public.empleado_sueldos;
create policy p_empleado_sueldos on public.empleado_sueldos to authenticated using (true) with check (true);

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
-- ⛔ Lo que hay que probar NO es que la tabla exista: es que un aumento NO cambie lo
--    que se pagó antes. Se simula el caso completo con un empleado real y se borra.
do $$
declare v_emp text; v_antes numeric; v_despues numeric; v_hoy numeric;
begin
  select id into v_emp from public.empleados where activo limit 1;
  if v_emp is null then raise exception 'no hay empleados activos: el control no probaria nada'; end if;

  insert into public.empleado_sueldos (empleado_id, monto_usd, forma_pago, desde, motivo, cargado_por)
  values (v_emp, 150, 'fijo', '2026-01-01', 'PRUEBA — se borra', 'control positivo'),
         (v_emp, 180, 'fijo', '2026-09-01', 'PRUEBA — aumento',  'control positivo');

  v_antes   := public.sueldo_vigente(v_emp, '2026-08-15');  -- una nomina YA pagada
  v_despues := public.sueldo_vigente(v_emp, '2026-09-15');  -- despues del aumento
  v_hoy     := (select sueldo from public.empleados where id = v_emp);

  if v_antes is distinct from 150 then
    raise exception 'el aumento de septiembre cambio la nomina de agosto: devolvio % en vez de 150', v_antes;
  end if;
  if v_despues is distinct from 180 then
    raise exception 'el aumento no rige en septiembre: devolvio %', v_despues;
  end if;
  if v_hoy is distinct from 150 then
    raise exception 'un aumento con fecha FUTURA cambio lo que gana hoy: empleados.sueldo quedo en %', v_hoy;
  end if;
  if public.sueldo_vigente(v_emp, '2025-06-01') is not null then
    raise exception 'una fecha anterior al primer sueldo devolvio un numero en vez de NULL';
  end if;

  delete from public.empleado_sueldos where cargado_por = 'control positivo';
  raise notice 'OK — agosto: % · septiembre: % · hoy: % · antes de todo: NULL', v_antes, v_despues, v_hoy;
end $$;
