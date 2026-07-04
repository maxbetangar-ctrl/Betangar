-- ════════════════════════════════════════════════════════════════════════════
-- C2 Fase 2 · PASO 1 — RPC aplicar_accion_aprobada(token)
-- Enforcement server-side: aplica una acción de plata SOLO si su token está
-- APROBADO (aprobado=true), no usado y no vencido. SECURITY DEFINER = corre como
-- dueño, así podrá escribir aunque luego bloqueemos la escritura directa a los roles.
--
-- ⚠️ 100% SEGURO DE CORRER AHORA: solo CREA una función. No bloquea nada, no cambia
--    RLS, no toca datos. Nadie la llama todavía. Reversible con: drop function.
--
-- Whitelist de tablas: SOLO plata no-BNC / no-chofer. Explícitamente NO incluye
--    bnc_*, pagos_bnc, ni viajes_chofer/checklist/entregas/km_data/etc.
--
-- Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.aplicar_accion_aprobada(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tokens_pendientes;
  ad jsonb; v_op text; v_tabla text; v_col text; v_val text; v_set jsonb;
  k text; sets text[] := array[]::text[];
  permitidas text[] := array['planillas','abonos','gastos_variables','gastos_fijos',
                             'cxp','prestamos','multas','contratos','gasoil','nomina_historial'];
begin
  select * into v_row from public.tokens_pendientes where token = p_token order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'token inexistente'); end if;
  if v_row.aprobado is not true then return jsonb_build_object('ok', false, 'error', 'no aprobado'); end if;
  if v_row.usado is true then return jsonb_build_object('ok', false, 'error', 'ya usado'); end if;
  if v_row.expira is not null and v_row.expira < now() then return jsonb_build_object('ok', false, 'error', 'expirado'); end if;

  ad := v_row.accion_data;
  if ad is null then
    update public.tokens_pendientes set usado = true where id = v_row.id;
    return jsonb_build_object('ok', true, 'nota', 'aprobado sin accion_data (lo aplica el cliente)');
  end if;

  v_op := ad->>'op'; v_tabla := ad->>'tabla'; v_col := ad->>'col'; v_val := ad->>'val';
  if not (v_tabla = any(permitidas)) then
    return jsonb_build_object('ok', false, 'error', 'tabla no permitida: '||coalesce(v_tabla,'null'));
  end if;
  if v_col is null or v_val is null then
    return jsonb_build_object('ok', false, 'error', 'falta col/val');
  end if;

  if v_op = 'del' then
    execute 'delete from public.'||quote_ident(v_tabla)||' where '||quote_ident(v_col)||' = $1' using v_val;
  elsif v_op = 'upd' then
    v_set := ad->'set';
    if v_set is null then return jsonb_build_object('ok', false, 'error', 'upd sin set'); end if;
    for k in select jsonb_object_keys(v_set) loop
      sets := array_append(sets, quote_ident(k)||' = '||quote_nullable(v_set->>k));
    end loop;
    execute 'update public.'||quote_ident(v_tabla)||' set '||array_to_string(sets, ', ')||
            ' where '||quote_ident(v_col)||' = $1' using v_val;
  else
    return jsonb_build_object('ok', false, 'error', 'op no soportada: '||coalesce(v_op,'null'));
  end if;

  update public.tokens_pendientes set usado = true where id = v_row.id;
  return jsonb_build_object('ok', true, 'op', v_op, 'tabla', v_tabla);
end $$;

grant execute on function public.aplicar_accion_aprobada(text) to authenticated;

-- VERIFICAR (después, con datos de prueba): crear una fila de prueba en una tabla de la
-- whitelist + un token aprobado con su accion_data del, y llamar el RPC → debe borrarla y
-- marcar usado. Un token NO aprobado → debe devolver {ok:false,'no aprobado'} sin tocar nada.
