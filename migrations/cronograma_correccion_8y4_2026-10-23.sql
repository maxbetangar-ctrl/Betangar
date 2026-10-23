-- ════════════════════════════════════════════════════════════════════════════
--  Correccion del cronograma: lunes y jueves son 8 + 4, no 7 + 2.
--
--  COMO APARECIO. El cronograma declarado el 22/10 decia Olegario Villalobos 7 +
--  Santa Lucia 2 = 9 camiones los lunes y jueves. Las planillas decian otra
--  cosa: **los 12 camiones salen todos los lunes y jueves** (B001 a B012, nueve
--  de cada diez jornadas; una sola vez fueron 11). Al mostrarle la diferencia,
--  Maximo contesto: «fue equivocacion mia, son 8 camiones en Olegario y 4 en
--  Santa Lucia». 8 + 4 = 12, y cuadra exacto con lo medido.
--
--  ⛔ SE CORRIGE LA FILA, NO SE CREA UNA VERSION NUEVA. `vigente_desde` existe
--     para cuando la REGLA cambia; acá la regla nunca fue 7+2: fue un error al
--     declararla. Crear una version nueva haria que un lunes pasado se juzgara
--     con un reparto que no existio nunca, y el dia que alguien revise por que
--     «el 19/10 tocaban 9 camiones» no habria explicacion posible.
--     [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
--  📌 Y lo que vale la pena recordar de esto: **el dato encontro el error en la
--     declaracion de su dueño**. No al reves. Por eso la contradiccion se
--     mostro como pregunta y no como correccion.
-- ════════════════════════════════════════════════════════════════════════════

update cronograma_recoleccion
   set camiones = 8
 where tipo = 'parroquia'
   and parroquia = 'Parroquia Olegario Villalobos'
   and dia_semana in (1, 4)
   and vigente_desde = '2026-10-22';

update cronograma_recoleccion
   set camiones = 4
 where tipo = 'parroquia'
   and parroquia = 'Parroquia Santa Lucía'
   and dia_semana in (1, 4)
   and vigente_desde = '2026-10-22';

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare uid text; lun int; jue int; mar int; mie int; obs numeric;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  select sum(camiones) into lun from cronograma_recoleccion
   where dia_semana = 1 and tipo = 'parroquia' and vigente_desde = '2026-10-22';
  select sum(camiones) into jue from cronograma_recoleccion
   where dia_semana = 4 and tipo = 'parroquia' and vigente_desde = '2026-10-22';
  if lun <> 12 or jue <> 12 then
    raise exception 'CONTROL: lunes suma % y jueves %, se esperaban 12 y 12', lun, jue;
  end if;

  -- Los otros dias no se tocaron.
  select sum(camiones) into mar from cronograma_recoleccion
   where dia_semana = 2 and tipo = 'parroquia' and vigente_desde = '2026-10-22';
  select sum(camiones) into mie from cronograma_recoleccion
   where dia_semana = 3 and tipo = 'parroquia' and vigente_desde = '2026-10-22';
  if mar <> 12 or mie <> 12 then
    raise exception 'CONTROL: se toco un dia que no habia que tocar (mar=%, mie=%)', mar, mie;
  end if;

  -- ⛔ Y NO HAY UNA VERSION NUEVA: si alguien la creara, un dia pasado se
  --    juzgaria con un reparto que nunca existio.
  if (select count(distinct vigente_desde) from cronograma_recoleccion) <> 1 then
    raise exception 'CONTROL: aparecio mas de una version del cronograma; esto era una '
      'correccion de un error de tipeo, no un cambio de regla';
  end if;

  -- Y ahora el cronograma tiene que coincidir con lo que DE VERDAD sale a la
  -- calle: el promedio de camiones de los lunes y jueves de las ultimas semanas.
  select round(avg(c)::numeric, 1) into obs from (
    select count(*) c from planillas
     where extract(dow from f::date) in (1,4) and f::date > current_date - 42 and t is not null
     group by f::date) x;
  if abs(obs - 12) > 1 then
    raise exception 'CONTROL: el cronograma dice 12 pero en la calle salen % camiones los '
      'lunes y jueves. Siguen sin coincidir.', obs;
  end if;

  raise notice 'OK - lunes y jueves 12 camiones (8 Olegario + 4 Santa Lucia), y en la calle '
    'salen % en promedio', obs;
end $$;
