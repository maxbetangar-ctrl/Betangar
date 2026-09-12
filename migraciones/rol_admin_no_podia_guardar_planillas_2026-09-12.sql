-- ============================================================================
-- EL ROL `admin` NO PODIA GUARDAR PLANILLAS, GASOIL NI GASOL   ·  12/09/2026
--
-- 🔴 COMO SE ENCONTRO. Verificando otra cosa aparecio un hueco en los datos:
--    · `planillas`  -- ultima el 09/09, y del 25/08 al 09/09 habia 11-13 por dia
--    · `surtidas`   -- ultima el 05/09
--    · `gasoil`     -- ultima el 02/09
--    ...con 11-12 checklists POR DIA hasta hoy, o sea que los camiones salieron.
--
-- ⛔ LA CAUSA, PROBADA. La migracion de seguridad `rls_fix_auditoria_2026-07-12`
--    cerro las tablas del dinero -- bien, antes escribia cualquier autenticado --
--    y enumero los roles permitidos:
--      superadmin, operador, rrhh, directivo, demo_admin, demo_operador, demo_rrhh
--    (mas `revisor`, agregado despues). **`admin` NUNCA estuvo en esa lista.**
--
--    Y la app SI le da a `admin` esas pantallas: en `app.js` el rol `admin`
--    tiene 'planilla', 'nomina', 'combustible' y 'requisitorio'.
--    ⇒ La pantalla se ofrece y la base rechaza la escritura.
--    [[norma-la-pieza-dice-lo-que-no-hace]]
--
--    Comprobado desde la sesion real del unico usuario con rol `admin`
--    (`set local role authenticated` + su `sub`, dentro de `begin … rollback`):
--      insert into planillas … → ERROR 42501:
--      «new row violates row-level security policy for table "planillas"»
--
-- ⚠️ NO ES UNA REGRESION DE HOY. El hueco tiene dos meses y recien mordio cuando
--    la persona que carga las planillas es `admin` (entro el 18/08). Antes las
--    cargaba alguien con un rol que si estaba en la lista.
--
-- ⇒ QUE HACE ESTO: agrega `admin` a las 8 policies que lo omitian
--   (planillas, gasoil, gasol, cuadrilla_dia × INSERT y UPDATE).
--   `admin` es MAS privilegiado que `operador`, que ya estaba permitido: esto no
--   abre nada nuevo, repone lo que la app ya ofrece.
--   NO se toca `plan_del_superadmin`: BORRAR sigue siendo solo de superadmin.
--
-- ⚠️ `cuadrilla_dia` se incluye por paridad -- sus policies tienen el mismo
--    olvido -- aunque ahi NO hay hueco de datos (escribe hasta hoy, o sea que
--    quien la usa no es `admin`).
-- ============================================================================

-- La lista completa, en un solo lugar para que no se vuelva a desincronizar.
-- Si mañana nace un rol nuevo con pantalla de dinero, se agrega ACA.
--
-- ⚠️ LOS NOMBRES DE POLICY NO SE SUPONEN, SE LISTAN. El primer intento asumio
--    que las cuatro tablas usaban `btg_ins`/`btg_upd` y `cuadrilla_dia` usa
--    `cuad_ins`/`cuad_upd`: habria creado una policy NUEVA al lado de la vieja
--    -- y como Postgres hace OR entre policies permisivas, habria FUNCIONADO
--    dejando un duplicado que nadie entiende. Lo freno el control de abajo.
--    Comprobado antes de reescribir: las 8 tienen la MISMA forma
--    (lista de roles + `not app_solo_lectura()`), sin condiciones extra.
do $$
declare
  roles text := $r$array['superadmin','admin','revisor','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']$r$;
  obj   text[];
  tabla text; ins text; upd text;
begin
  foreach obj slice 1 in array array[
      array['planillas',     'plan_ins', 'plan_upd'],
      array['gasoil',        'btg_ins',  'btg_upd' ],
      array['gasol',         'btg_ins',  'btg_upd' ],
      array['cuadrilla_dia', 'cuad_ins', 'cuad_upd']
  ] loop
    tabla := obj[1]; ins := obj[2]; upd := obj[3];

    execute format('drop policy if exists %I on public.%I', ins, tabla);
    execute format($f$create policy %I on public.%I for insert to authenticated
                      with check (public.app_rol() = any(%s) and not public.app_solo_lectura())$f$,
                   ins, tabla, roles);

    execute format('drop policy if exists %I on public.%I', upd, tabla);
    execute format($f$create policy %I on public.%I for update to authenticated
                      using (public.app_rol() = any(%s) and not public.app_solo_lectura())
                      with check (public.app_rol() = any(%s) and not public.app_solo_lectura())$f$,
                   upd, tabla, roles, roles);
  end loop;
end $$;

-- ── Control: que no quede NINGUNA policy que enumere roles y olvide `admin` ──
-- Se compara contra 'operador' porque esa es la marca de «esta policy enumera
-- roles de la app». No se compara contra 'superadmin': contiene 'admin' como
-- texto y daria un falso OK.
do $$
declare n int; detalle text;
begin
  select count(*), coalesce(string_agg(tablename || '.' || policyname, ', '), '')
    into n, detalle
    from pg_policies
   where schemaname='public'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%''operador''%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) not like '%''admin''%';
  if n > 0 then
    raise exception 'Quedan % policies que enumeran roles y olvidan admin: %', n, detalle;
  end if;
  raise notice 'OK: ninguna policy enumera roles sin incluir admin.';
end $$;
