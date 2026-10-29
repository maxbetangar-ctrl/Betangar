-- ════════════════════════════════════════════════════════════════════════════
--  EL CRONOGRAMA DEL IMAU QUE RIGE DESDE EL LUNES 26/10/2026.
--
--  Lo mandó Máximo al aparato de MAXWARE el 29/10. La base tenía cargado el
--  del 22/10 y la pantalla de flota venía mostrando ESE: Caracciolo con 12
--  camiones los viernes, Olegario con 7 los lunes. Ya no es así.
--
--  ⛔ NO SE PISA EL VIEJO, SE AGREGA UNA VERSIÓN. `cronograma_del_dia` elige
--     `max(vigente_desde) <= la fecha consultada`, así que mirar el 23/10 sigue
--     devolviendo lo que regía el 23/10. Un cronograma pisado haría que una
--     denuncia de la semana pasada se conteste con las reglas de esta.
--
--  Lo que cambia contra el del 22/10:
--    · Olegario Villalobos  7 → 8   (y Santa Lucía 2 → 4)
--    · Caracciolo Parra Pérez 12 → 10, y entra Luis Hurtado Higuera con 2
--    · Venancio Pulgar sigue en 12
--  Total: 12 compactadoras todos los días, que son las 12 de la flota.
-- ════════════════════════════════════════════════════════════════════════════

insert into cronograma_recoleccion (dia_semana, tipo, parroquia, camiones, nota, vigente_desde) values
  -- Lunes y jueves
  (1, 'parroquia', 'Parroquia Olegario Villalobos',  8, null, '2026-10-26'),
  (1, 'parroquia', 'Parroquia Santa Lucía',          4, 'Compartida con Reco.', '2026-10-26'),
  (4, 'parroquia', 'Parroquia Olegario Villalobos',  8, null, '2026-10-26'),
  (4, 'parroquia', 'Parroquia Santa Lucía',          4, 'Compartida con Reco.', '2026-10-26'),
  -- Martes y viernes
  (2, 'parroquia', 'Parroquia Caracciolo Parra Pérez', 10, null, '2026-10-26'),
  (2, 'parroquia', 'Parroquia Luis Hurtado Higuera',    2, 'Compartida con Fospuca y Transteca.', '2026-10-26'),
  (5, 'parroquia', 'Parroquia Caracciolo Parra Pérez', 10, null, '2026-10-26'),
  (5, 'parroquia', 'Parroquia Luis Hurtado Higuera',    2, 'Compartida con Fospuca y Transteca.', '2026-10-26'),
  -- Miércoles y sábado
  (3, 'parroquia', 'Parroquia Venancio Pulgar', 12, 'Compartida con Transbasuca y Transteca.', '2026-10-26'),
  (6, 'parroquia', 'Parroquia Venancio Pulgar', 12, 'Compartida con Transbasuca y Transteca.', '2026-10-26'),
  -- Domingo
  (0, 'operativo_imau', null, null,
      'El operativo del domingo lo define el IMAU; no hay parroquia asignada de antemano.', '2026-10-26');

-- ── CONTROL ─────────────────────────────────────────────────────────────────
--
-- ⛔ No alcanza con que las filas entren. Se exige lo que tiene que ser cierto:
--    1. que cada día de lunes a sábado sume 12 compactadoras — son las que hay;
--    2. que las parroquias nombradas EXISTAN en `parroquias`, porque el mapa
--       las busca por nombre y una que no calza no se dibuja y nadie se entera;
--    3. que consultar el 23/10 siga devolviendo el cronograma VIEJO.
do $$
declare d int; n int; faltan text; viejo int;
begin
  for d in 1..6 loop
    select sum(camiones) into n from cronograma_recoleccion
     where dia_semana = d and vigente_desde = '2026-10-26';
    if n is distinct from 12 then
      raise exception 'CONTROL FALLIDO: el día % suma % compactadoras y la flota son 12.', d, n;
    end if;
  end loop;

  select string_agg(distinct c.parroquia, ', ') into faltan
    from cronograma_recoleccion c
   where c.vigente_desde = '2026-10-26' and c.parroquia is not null
     and not exists (select 1 from parroquias p where p.nombre = c.parroquia);
  if faltan is not null then
    raise exception 'CONTROL FALLIDO: estas parroquias no existen en `parroquias` y el mapa no las va a encontrar: %', faltan;
  end if;

  -- El pasado no se toca: el viernes 23/10 regía Caracciolo con 12.
  select camiones into viejo from cronograma_recoleccion
   where dia_semana = 5 and parroquia = 'Parroquia Caracciolo Parra Pérez'
     and vigente_desde = (select max(vigente_desde) from cronograma_recoleccion
                           where dia_semana = 5 and vigente_desde <= '2026-10-23');
  if viejo is distinct from 12 then
    raise exception 'CONTROL FALLIDO: consultar el 23/10 devuelve % camiones en Caracciolo; debía devolver los 12 que regían ese día.', viejo;
  end if;

  raise notice 'CONTROL: los 6 días suman 12 compactadoras, las parroquias existen, y el 23/10 sigue devolviendo el cronograma viejo.';
end $$;
