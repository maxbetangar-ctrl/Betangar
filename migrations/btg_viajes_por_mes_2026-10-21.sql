-- ============================================================================
-- LOS VIAJES MES A MES, DESDE LA BASE — 21/10/2026.
--
-- POR QUE EXISTE
-- Los socios preguntaron cuantas toneladas se movieron mes a mes desde que
-- arranco la operacion. El dato existia —2.097 planillas desde el 04/03/2026—
-- pero no habia donde mirarlo: hubo que contarlo a mano contra la base, igual
-- que el costo por tonelada la semana pasada y los gastos de arranque ayer.
-- Tres veces seguidas el mismo sintoma: el numero esta y el dueño no lo puede
-- sacar solo. [[norma-la-auditoria-es-el-producto]]
--
-- ⛔ SALE DE LA BASE, NO DE `REGS`. Es la misma trampa que ya reviento el
--    20/10 con `btg_operacion_periodo`: el informe leia los viajes del array
--    del NAVEGADOR y la pantalla llego a decir «no hay viajes cargados» dos
--    renglones debajo de «3.185 viajes». Ademas Supabase devuelve ~1000 filas
--    por consulta y `planillas` ya pasa las 2.000: contar en el navegador es
--    contar lo que alcanzo a llegar. [[norma-fuente-unica-datos]]
--
-- ⛔ ACA NO HAY TONELADAS, Y ES A PROPOSITO. Devuelve VIAJES. La tonelada sale
--    de multiplicar por la capacidad declarada del camion (8 t, Config ▸
--    General), y esa definicion vive en UN solo lugar del front
--    (`_tonsPorViaje()`). Si la base tambien multiplicara, el dia que Maximo
--    cambie el 8 habria dos respuestas distintas a la misma pregunta.
--    [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- `dias` son los dias CON viajes registrados, no los dias del mes: es lo unico
-- con lo que se pueden comparar meses de distinto largo (y marzo, que empezo
-- el 04, y el mes en curso, que va por donde va).
-- ============================================================================

create or replace function btg_viajes_por_mes()
returns table (
  mes       text,     -- 'YYYY-MM'
  planillas bigint,
  viajes    bigint,   -- ⛔ VIAJES, no toneladas (ver cabecera)
  monto_usd numeric,  -- trabajo ejecutado a tarifa: NO es lo facturado ni lo cobrado
  dias      bigint,   -- dias con viajes registrados
  unidades  bigint,
  primera   text,
  ultima    text
)
language sql
stable
security definer
set search_path = public
as $$
  select substr(f,1,7),
         count(*),
         coalesce(sum(t),0)::bigint,
         coalesce(round(sum(m)::numeric,2),0),
         count(distinct f),
         count(distinct cam),
         min(f),
         max(f)
    from planillas
   where f is not null and f <> ''
   group by 1
   order by 1
$$;

comment on function btg_viajes_por_mes is
  'Viajes, planillas y trabajo ejecutado por mes, desde `planillas`. ⛔ Devuelve VIAJES, no toneladas: la capacidad por viaje la declara la empresa y vive en el front (_tonsPorViaje). `monto_usd` es trabajo ejecutado a tarifa, NO lo facturado ni lo cobrado.';

revoke all on function btg_viajes_por_mes() from anon, public;
grant execute on function btg_viajes_por_mes() to authenticated;

-- ── CONTROL POSITIVO: que reviente aca y no en la pantalla del socio ────────
do $$
declare
  n_meses   bigint;
  v_funcion bigint;
  v_tabla   bigint;
begin
  select count(*), coalesce(sum(viajes),0) into n_meses, v_funcion from btg_viajes_por_mes();
  select coalesce(sum(t),0) into v_tabla from planillas where f is not null and f <> '';

  if n_meses < 1 then
    raise exception 'btg_viajes_por_mes() no devolvio ningun mes y la tabla tiene filas';
  end if;

  -- ⛔ Lo que importa no es que conteste: es que no se pierda ni un viaje por el
  --    camino. Un `group by` sobre una fecha mal escrita descarta filas en
  --    silencio y el total del informe sale mas bajo sin que nada avise.
  if v_funcion <> v_tabla then
    raise exception 'la funcion suma % viajes y la tabla %: el agrupamiento esta perdiendo filas',
      v_funcion, v_tabla;
  end if;

  if has_function_privilege('anon', 'btg_viajes_por_mes()', 'execute') then
    raise exception 'anon puede ejecutar btg_viajes_por_mes(): la operacion de la empresa no es publica';
  end if;

  raise notice 'OK · % mes(es), % viajes, igual que la tabla · anon no puede ejecutarla', n_meses, v_funcion;
end $$;
