-- guard_nomina_bnc_authenticated_2026-07-17.sql  (base compartida hrkjddehqnzcqwlkklqm + Flotilla mcvizzknpqrggohbohcw)
-- Espejar en Betangar y flotilla-app. Aplicar en AMBAS bases.
-- Barrido de 'authenticated' 2026-07-17: avanzar_nomina (escribe nomina_historial + marca prestamos
-- pagados) y bnc_actualizar_config (reescribe credenciales del banco BNC, incl. URLs de notificacion)
-- eran ejecutables por CUALQUIER authenticated sin chequeo de rol. En la base compartida un papa de
-- Geppetto/Ranita (authenticated, NO en btg_usuarios) podia pegarles directo por /rest/v1/rpc.
-- FIX (Opcion A, minima): guard 'if app_rol() is null then raise'. app_rol() devuelve el rol de
-- btg_usuarios (null si el que llama no es de oficina). No traba a ningun usuario de oficina.
-- Se llaman client-side (Betangar/flotilla-app app.js) como authenticated -> no se puede revocar authenticated.
-- PENDIENTE (Opcion B): restringir por rol (BNC = solo superadmin) cuando Maximo confirme los roles.

CREATE OR REPLACE FUNCTION public.avanzar_nomina(p_row jsonb, p_prestamos jsonb, p_multas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := p_row->>'id';
  v_ya boolean;
  e jsonb;
begin
  if app_rol() is null then raise exception 'no autorizado (se requiere usuario de oficina)' using errcode = '42501'; end if;
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

  if not v_ya then
    for e in select value from jsonb_array_elements(coalesce(p_prestamos,'[]'::jsonb)) loop
      update prestamos set
        semanas_pagadas = coalesce(semanas_pagadas,0)+1,
        pagado = coalesce(pagado,0) + coalesce(nullif(e->>'cuota','')::numeric,0),
        estado = case when coalesce(semanas_pagadas,0)+1 >= semanas then 'pagado' else estado end
      where id = (e->>'id') and estado='activo' and coalesce(semanas_pagadas,0) < semanas;
    end loop;
    -- pagado_bs acumula el Bs REAL pagado (cuotaBs lo trae el JS: cuotaUsd × tasa$ del día). pagado_div = divisa.
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
end $function$
;

CREATE OR REPLACE FUNCTION public.bnc_actualizar_config(p_client_guid text DEFAULT NULL::text, p_master_key text DEFAULT NULL::text, p_cuenta text DEFAULT NULL::text, p_telefono_pm text DEFAULT NULL::text, p_moneda text DEFAULT NULL::text, p_url_dev text DEFAULT NULL::text, p_url_prod text DEFAULT NULL::text, p_client_id text DEFAULT NULL::text, p_base_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if app_rol() is null then raise exception 'no autorizado (se requiere usuario de oficina)' using errcode = '42501'; end if;
  select id into v_id from bnc_config order by updated_at desc nulls last limit 1;
  if v_id is null then
    insert into bnc_config(client_guid, master_key, cuenta, telefono_pm, moneda,
                           url_notificacion_dev, url_notificacion_prod, client_id, base_url, activo, updated_at)
    values (p_client_guid, p_master_key, p_cuenta, p_telefono_pm, coalesce(p_moneda,'VES'),
            p_url_dev, p_url_prod, p_client_id, p_base_url, true, now());
    return;
  end if;
  update bnc_config set
    client_guid = case when p_client_guid is not null and length(trim(p_client_guid))>0 then p_client_guid else client_guid end,
    master_key  = case when p_master_key  is not null and length(trim(p_master_key)) >0 then p_master_key  else master_key  end,
    client_id   = case when p_client_id   is not null and length(trim(p_client_id))  >0 then p_client_id   else client_id   end,
    base_url    = case when p_base_url    is not null and length(trim(p_base_url))   >0 then p_base_url    else base_url    end,
    cuenta      = coalesce(p_cuenta, cuenta),
    telefono_pm = coalesce(p_telefono_pm, telefono_pm),
    moneda      = coalesce(p_moneda, moneda),
    url_notificacion_dev  = coalesce(p_url_dev,  url_notificacion_dev),
    url_notificacion_prod = coalesce(p_url_prod, url_notificacion_prod),
    activo      = true,
    updated_at  = now()
  where id = v_id;
end;
$function$
;
