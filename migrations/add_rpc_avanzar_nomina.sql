-- ════════════════════════════════════════════════════════════════════════════
-- RPC TRANSACCIONAL: guardar nómina + avanzar cuotas de préstamos/multas EN UNA SOLA TRANSACCIÓN.
-- Cierra el crítico de la auditoría: antes el avance se hacía en JS en 2 pasos no atómicos →
-- si fallaba el 2º write, podía DOBLE-COBRAR al empleado o perder la cuota. Ahora es todo-o-nada.
-- Guarda anti-doble: las cuotas SOLO avanzan la 1ª vez que se guarda esa nómina (id único).
-- SECURITY DEFINER: corre con privilegios del owner (mutación de dinero controlada por la app).
-- Correr en Supabase SQL Editor ANTES de desplegar el código que la llama (v=20260628t+).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.avanzar_nomina(p_row jsonb, p_prestamos jsonb, p_multas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := p_row->>'id';
  v_ya boolean;
  e jsonb;
begin
  select exists(select 1 from nomina_historial where id = v_id) into v_ya;

  insert into nomina_historial(id,semana,periodo,fecha_desde,fecha_hasta,total_usd,total_bs,op_usd,adm_usd,imau_bs,tasa,detalle,fuente)
  values(
    v_id, p_row->>'semana', p_row->>'periodo',
    nullif(p_row->>'fecha_desde','')::date, nullif(p_row->>'fecha_hasta','')::date,
    nullif(p_row->>'total_usd','')::numeric, nullif(p_row->>'total_bs','')::numeric,
    nullif(p_row->>'op_usd','')::numeric, nullif(p_row->>'adm_usd','')::numeric,
    nullif(p_row->>'imau_bs','')::numeric, nullif(p_row->>'tasa','')::numeric,
    p_row->'detalle', p_row->>'fuente'
  )
  on conflict(id) do update set
    semana=excluded.semana, periodo=excluded.periodo, fecha_desde=excluded.fecha_desde,
    fecha_hasta=excluded.fecha_hasta, total_usd=excluded.total_usd, total_bs=excluded.total_bs,
    op_usd=excluded.op_usd, adm_usd=excluded.adm_usd, imau_bs=excluded.imau_bs,
    tasa=excluded.tasa, detalle=excluded.detalle, fuente=excluded.fuente;

  -- Avance de cuotas SOLO la primera vez (anti doble-cobro). Cada UPDATE es idempotente por su
  -- guarda (estado='activo' AND pagadas < total): si ya estaba al día, no toca nada.
  if not v_ya then
    for e in select value from jsonb_array_elements(coalesce(p_prestamos,'[]'::jsonb)) loop
      update prestamos set
        semanas_pagadas = coalesce(semanas_pagadas,0)+1,
        pagado = coalesce(pagado,0) + coalesce(nullif(e->>'cuota','')::numeric,0),
        estado = case when coalesce(semanas_pagadas,0)+1 >= semanas then 'pagado' else estado end
      where id = (e->>'id') and estado='activo' and coalesce(semanas_pagadas,0) < semanas;
    end loop;
    -- pagado_bs acumula el Bs REAL pagado, congelado a la tasa del día del pago (cuotaBs lo trae el
    -- JS ya convertido: cuotaUsd × tasa$ del día). pagado_div acumula la divisa descontada (progreso).
    for e in select value from jsonb_array_elements(coalesce(p_multas,'[]'::jsonb)) loop
      update multas set
        cuotas_pagas = coalesce(cuotas_pagas,0)+1,
        pagado_bs = coalesce(pagado_bs,0) + coalesce(nullif(e->>'cuotaBs','')::numeric,0),
        pagado_div = coalesce(pagado_div,0) + coalesce(nullif(e->>'cuotaDiv','')::numeric,0),
        estado = case when coalesce(cuotas_pagas,0)+1 >= cuotas then 'pagado' else estado end
      where id = (e->>'id') and estado='activo' and coalesce(cuotas_pagas,0) < cuotas;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'ya_existia', v_ya);
end $$;

-- Solo usuarios autenticados pueden ejecutarla (no el anon público).
revoke all on function public.avanzar_nomina(jsonb,jsonb,jsonb) from anon;
grant execute on function public.avanzar_nomina(jsonb,jsonb,jsonb) to authenticated;
