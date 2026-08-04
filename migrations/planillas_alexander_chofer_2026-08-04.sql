-- APP: Betangar — FECHA: 2026-08-04
--
-- 47 PLANILLAS TENÍAN AL CHOFER EQUIVOCADO, Y LAS FECHAS DE INGRESO LO PRUEBAN.
--
-- En el campo CHOFER de 50 planillas (13/05 → 02/08) figuraba ALEXANDER ARTURO PAZ GONZALEZ, que
-- está cargado como AYUDANTE, mientras ALEXANDER ENRIQUE HERNANDEZ PRIETO —el chofer— no aparecía
-- en ninguna. Se le preguntó a Gladys (RRHH) y respondió:
--
--   «hoy en la tarde verificamos que existe un error en el sistema, no en el excel. Alexander Arturo
--    Paz es AYUDANTE que ingresó 10-07. El compañero Alexander Enrique Hernández Prieto con cargo de
--    Chófer... pero el mismo trabajó como ayudante en la primera semana»
--
-- Las fechas de ingreso guardadas confirman su versión sin lugar a dudas:
--   • HERNANDEZ PRIETO (chofer)  → ingresó 2026-05-12, y las planillas arrancan el 13/05, al día
--     siguiente. Encaja exacto.
--   • PAZ GONZALEZ (ayudante)    → ingresó 2026-07-09. No pudo manejar en mayo ni en junio: no
--     trabajaba en la empresa.
--
-- ⚠️ OJO: `created_at` NO es la fecha de ingreso. Paz figura cargado al sistema el 11/06 pero
-- ingresó el 09/07, y Hernández cargado el 11/07 habiendo ingresado el 12/05. Usar `created_at`
-- como fecha de ingreso habría dado la respuesta contraria.
--
-- QUÉ SE CORRIGE Y QUÉ NO:
--   B) 18/05 → 08/07: 31 planillas. Paz ni había ingresado.                    → SE CORRIGE
--   C) 09/07 → 02/08: 16 planillas. Paz ya está, pero es AYUDANTE, no chofer.  → SE CORRIGE
--   A) 13/05 → 16/05:  3 planillas (7 viajes). Es la PRIMERA SEMANA de Hernández, justo la que
--      Gladys dice que él trabajó de AYUDANTE. Si iba de ayudante, el chofer era otro y no sabemos
--      quién.                                                                  → NO SE TOCA
--   Si nadie lo declaró, el documento no lo dice: esas 3 quedan como están hasta que Gladys diga
--   quién manejaba. Ver [norma-documento-no-afirma-lo-que-nadie-declaro].
--
-- ⚠️ NO se toca `nomina_historial`: esas semanas ya se pagaron y sus Bs están congelados a la tasa
-- del día. El monto no cambia (los viajes son los mismos, solo cambia a quién se le atribuyen), pero
-- re-guardarlas volvería a avanzar cuotas de préstamos y multas.
-- Ver [norma-transicion-de-lo-manual-al-sistema] y [pnl-cerrado-mes-congelado].

begin;

-- Respaldo para poder deshacerlo: queda el estado exacto de cada planilla tocada.
insert into public.configuracion (clave, valor)
select 'backup_planillas_alexander_2026-08-04',
       (select jsonb_agg(jsonb_build_object('id',id,'f',f,'cam',cam,'ch',ch))::text
          from public.planillas
         where ch = 'ALEXANDER ARTURO PAZ GONZALEZ' and f >= '2026-05-18')
on conflict (clave) do update set valor = excluded.valor;

update public.planillas
   set ch = 'ALEXANDER ENRIQUE HERNANDEZ PRIETO'
 where ch = 'ALEXANDER ARTURO PAZ GONZALEZ'
   and f >= '2026-05-18';   -- deja fuera la primera semana (13–16/05), que sigue en revisión

commit;

-- VERIFICACIÓN:
-- select ch, count(*), min(f), max(f) from planillas
--  where ch like 'ALEXANDER%' group by ch order by 2 desc;
--   Esperado: HERNANDEZ PRIETO con 47 (18/05→02/08) y PAZ GONZALEZ con 3 (13→16/05, en revisión).
--
-- PARA DESHACER:
-- update public.planillas p set ch = b.ch
--   from (select (j->>'id') as id, (j->>'ch') as ch
--           from public.configuracion c,
--                jsonb_array_elements(c.valor::jsonb) j
--          where c.clave='backup_planillas_alexander_2026-08-04') b
--  where p.id = b.id;
