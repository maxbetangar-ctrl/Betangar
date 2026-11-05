-- ════════════════════════════════════════════════════════════════════════════════════════
-- LA CUADRILLA TAMBIÉN ES POR TURNO.  2026-11-04  (corrige la migración de hace un rato)
--
-- 🔴 ESTO ARREGLA ALGO QUE QUEDÓ ROTO. La migración `dos_turnos_2026-11-04.sql` cambió la
--    llave de `cuadrilla_dia` de (fecha, cam, empleado_id) a (fecha, cam, turno, empleado_id)
--    y NO tocó `cuadrilla_declarar`, que la nombra en su `on conflict`. Un `on conflict` que
--    apunta a una llave que ya no existe no falla a medias: Postgres rechaza el insert entero
--    con «there is no unique or exclusion constraint matching the ON CONFLICT specification».
--    Esa función la llama CADA CHOFER al declarar su cuadrilla, a las 5:40 de la mañana.
--    Se detectó buscando a mano quién más usaba las llaves viejas, no porque algo avisara.
--    ⇒ Al cambiar una llave hay que buscar TODO lo que la nombra, incluido lo que vive
--      dentro de la base. [[norma-correccion-heredada-toca-todas-las-tablas]]
--
-- ⛔ Y el DELETE de adentro también tenía que acotarse: borraba todo lo que el chofer hubiera
--    declarado ese día para esa unidad, así que el chofer de la noche, al declarar la suya,
--    le habría borrado la cuadrilla al de la mañana — sin que nadie se enterara hasta que
--    alguien reclamara un pago.
-- ════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ⛔ Se borra la firma vieja ANTES: `create or replace` con un parámetro de más crea una
--    SEGUNDA función y la llamada queda ambigua. Y al borrar se pierden los GRANT, que se
--    devuelven abajo tal cual estaban (anon, authenticated, service_role).
drop function if exists public.cuadrilla_declarar(text, text, text, text[]);
drop function if exists public.cuadrilla_del_dia(text);

create or replace function public.cuadrilla_del_dia(p_cam text, p_turno text default 'diurno')
 returns table(empleado_id text, nombre text, cargo text, rol text, declarado_por text)
 language sql
 security definer
 set search_path to 'public', 'extensions'
as $fn$
  select c.empleado_id, c.nombre, c.cargo, c.rol, c.declarado_por
    from public.cuadrilla_dia c
   where c.cam = p_cam
     and c.fecha = (now() at time zone 'America/Caracas')::date
     and c.turno = coalesce(nullif(p_turno,''),'diurno')
   order by (c.rol <> 'chofer'), c.nombre;
$fn$;

create or replace function public.cuadrilla_declarar(p_cam text, p_id text, p_clave text,
                                                     p_ayudantes text[] default '{}'::text[],
                                                     p_turno text default 'diurno')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $fn$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_turno text := coalesce(nullif(p_turno,''),'diurno');
  v_nombre text; v_cargo text; v_ced4 text;
  v_ids text[]; v_n int := 0; v_desc text[] := '{}';
  r record;
begin
  -- 1) ¿Quién dice ser? Mismo criterio que `fichar_asistencia`: activo + últimos 4 de la cédula.
  select e.nombre, e.cargo, right(regexp_replace(coalesce(e.cedula,''),'[^0-9]','','g'),4)
    into v_nombre, v_cargo, v_ced4
  from public.empleados e where e.id = p_id and coalesce(e.activo,true) = true;
  if v_nombre is null then
    return jsonb_build_object('ok',false,'msg','No se encontró a esa persona activa');
  end if;
  if v_ced4 is null or v_ced4 <> right(regexp_replace(coalesce(p_clave,''),'[^0-9]','','g'),4) then
    return jsonb_build_object('ok',false,'msg','Clave (4 dígitos) incorrecta');
  end if;

  -- 2) La unidad tiene que existir y estar activa. El QR está pegado en el camión, pero el
  --    código se puede teclear: que exista no lo prueba, y aun así una unidad inventada no entra.
  if not exists (select 1 from public.unidad_config u where u.cam = p_cam and coalesce(u.activo,true) = true) then
    return jsonb_build_object('ok',false,'msg','Esa unidad no existe o está inactiva');
  end if;

  -- 3) Los ayudantes: hasta 4, sin repetidos, sin el propio chofer, y todos activos.
  --    ⚠️ El que no exista o esté inactivo NO tumba la declaración entera: se guarda el resto
  --    y se DEVUELVE a quién se dejó afuera. Trancar a un chofer a las 5 AM porque un nombre
  --    de la lista quedó viejo es peor que el hueco. [[norma-catalogo-no-puede-trancar-el-registro]]
  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_ayudantes,'{}')) as x
  where x is not null and btrim(x) <> '' and x <> p_id;
  if coalesce(array_length(v_ids,1),0) > 4 then
    return jsonb_build_object('ok',false,'msg','Máximo 4 ayudantes');
  end if;

  -- 4) Se reescribe lo que ESTE chofer declaró hoy para ESTA unidad y ESTE TURNO: declarar de
  --    nuevo corrige. No se toca lo que haya cargado la oficina (declarado_por 'oficina:...'):
  --    esa es la corrección de quien manda, y una re-declaración del chofer no puede pisarla.
  --    ⛔ Y NO SE TOCA EL OTRO TURNO: sin el filtro de abajo, el chofer de la noche le borraba
  --    la cuadrilla al de la mañana al declarar la suya.
  delete from public.cuadrilla_dia c
   where c.fecha = v_hoy and c.cam = p_cam and c.turno = v_turno
     and c.declarado_por like 'chofer:%';

  insert into public.cuadrilla_dia (fecha, cam, turno, empleado_id, nombre, cargo, rol, declarado_por)
  values (v_hoy, p_cam, v_turno, p_id, v_nombre, v_cargo, 'chofer', 'chofer:'||p_id)
  on conflict (fecha, cam, turno, empleado_id) do update
    set nombre = excluded.nombre, cargo = excluded.cargo, rol = excluded.rol,
        declarado_por = excluded.declarado_por, creado = now();

  if v_ids is not null then
    for r in select e.id, e.nombre, e.cargo
               from public.empleados e
              where e.id = any(v_ids) and coalesce(e.activo,true) = true
    loop
      insert into public.cuadrilla_dia (fecha, cam, turno, empleado_id, nombre, cargo, rol, declarado_por)
      values (v_hoy, p_cam, v_turno, r.id, r.nombre, r.cargo, 'ayudante', 'chofer:'||p_id)
      on conflict (fecha, cam, turno, empleado_id) do update
        set nombre = excluded.nombre, cargo = excluded.cargo, rol = excluded.rol,
            declarado_por = excluded.declarado_por, creado = now();
      v_n := v_n + 1;
    end loop;
    select array_agg(x) into v_desc
      from unnest(v_ids) as x
     where not exists (select 1 from public.empleados e
                        where e.id = x and coalesce(e.activo,true) = true);
  end if;

  return jsonb_build_object('ok',true,'chofer',v_nombre,'ayudantes',v_n,'turno',v_turno,
                            'descartados',coalesce(v_desc,'{}'),'fecha',v_hoy);
end $fn$;

revoke all on function public.cuadrilla_del_dia(text, text) from public;
revoke all on function public.cuadrilla_declarar(text, text, text, text[], text) from public;
grant execute on function public.cuadrilla_del_dia(text, text) to anon, authenticated, service_role;
grant execute on function public.cuadrilla_declarar(text, text, text, text[], text) to anon, authenticated, service_role;

commit;

-- Control: que `anon` pueda llamarlas, que es lo que falla en silencio.
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname in ('cuadrilla_declarar','cuadrilla_del_dia')
 order by 1;
