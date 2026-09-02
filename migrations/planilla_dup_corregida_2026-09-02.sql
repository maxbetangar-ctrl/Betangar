-- ═══════════════════════════════════════════════════════════════════════════════
-- BORRAR UNA PLANILLA «DUP» QUE YA FUE CORREGIDA — por RPC, no por policy
--
-- 🔴 REPORTE DE GLADIS (RRHH), 02/09/2026, por nota de voz:
--    «me sigue arrojando el error que las planillas tienen el número repetido y que
--     debo corregir el Excel… díganme si es algo del sistema que no está actualizado»
--
--    Tenía razón, y había DOS candados en serie:
--
--    1. El importador buscaba la DUP como 'DUP'+<numero nuevo>. Ella hizo lo
--       correcto —les puso correlativos NUEVOS (01583, 01584)— así que buscaba
--       `DUP01583`, que nunca existió, mientras las huérfanas eran `DUP01572` y
--       `DUP01573`. (Arreglado en `app.js`: ahora se reconocen por fecha+camión+chofer.)
--
--    2. ⛔ Y AUNQUE LA ENCONTRARA, EL BORRADO LE FALLABA IGUAL: la policy DELETE de
--       `planillas` exige `app_puede_borrar()`, que es `superadmin` sin token. Gladis
--       es `rrhh`. El delete se iba en silencio y la DUP volvía al recargar.
--
--    Consecuencia medida: `DUP01572` y `DUP01573` llevaban desde el 01/09 sumando
--    **6 viajes y US$ 1.901,28** en los totales, porque ningún cálculo excluye las DUP.
--
-- ⛔ POR QUÉ UN RPC Y NO ABRIR LA POLICY. Abrirle DELETE a `rrhh` le daría permiso de
--    borrar CUALQUIER planilla — incluidas las buenas, que es dinero facturado. Este
--    RPC solo puede borrar una fila que cumple las dos condiciones a la vez: que sea
--    una DUP, y que el MISMO viaje ya esté cargado con un número válido. Si el
--    reemplazo no existe, no borra: devuelve el motivo. Es el patrón que ya se usa en
--    `surtidas`, donde la falta de policy INSERT es a propósito.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.planilla_borrar_dup_corregida(p_dup text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup   planillas%rowtype;
  v_reemp text;
begin
  -- Quien puede CARGAR planillas puede limpiar su propia duplicada. No hace falta
  -- ser superadmin: lo que limita el daño es la comprobación de abajo, no el rol.
  if public.app_solo_lectura() then
    return jsonb_build_object('ok', false, 'motivo', 'la sesion es de solo lectura');
  end if;
  if public.app_rol() not in ('superadmin','operador','rrhh','directivo','revisor') then
    return jsonb_build_object('ok', false, 'motivo', 'su rol no cambia planillas: ' || coalesce(public.app_rol(),'(sin rol)'));
  end if;

  -- ⛔ Solo filas DUP. Nunca una planilla real.
  if p_dup is null or p_dup !~ '^DUP' then
    return jsonb_build_object('ok', false, 'motivo', 'solo se pueden borrar planillas DUP');
  end if;

  select * into v_dup from planillas where p = p_dup;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'esa planilla no existe (quiza ya se borro)');
  end if;

  -- ⛔ EL CANDADO QUE IMPORTA: el mismo viaje tiene que estar YA cargado con un
  --    numero valido. Sin esto, borrar la DUP perderia el viaje —y con el, lo que
  --    se le factura al cliente por el.
  select p into v_reemp
    from planillas
   where p <> v_dup.p
     and p !~ '^DUP'
     and f = v_dup.f
     and cam = v_dup.cam
     and upper(coalesce(ch,'')) = upper(coalesce(v_dup.ch,''))
   limit 1;

  if v_reemp is null then
    return jsonb_build_object('ok', false, 'motivo',
      'no hay otra planilla con ese mismo viaje (' || v_dup.f || ', ' || v_dup.cam ||
      '): si se borra, el viaje se pierde');
  end if;

  delete from planillas where p = p_dup;

  return jsonb_build_object('ok', true, 'borrada', p_dup, 'reemplazada_por', v_reemp,
                            'viajes', v_dup.t, 'monto', v_dup.m);
end;
$$;

revoke all on function public.planilla_borrar_dup_corregida(text) from public, anon;
grant execute on function public.planilla_borrar_dup_corregida(text) to authenticated;

comment on function public.planilla_borrar_dup_corregida(text) is
  'Borra una planilla DUP solo si el mismo viaje (fecha+camion+chofer) ya esta cargado con un numero valido. Nacio del reporte de Gladis del 02/09/2026: la policy DELETE exige superadmin y RRHH no podia limpiar sus propias duplicadas.';
