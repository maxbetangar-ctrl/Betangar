-- tanque_tabla_desde_2026-07-25.sql   (Betangar — hrkjddehqnzcqwlkklqm)
-- Requiere: tanque_jac_cubicacion_real_2026-07-25.sql
--
-- EL EFECTO SECUNDARIO DE CAMBIAR LA TABLA
--
-- R8 compara los `litros_calculados` que quedaron guardados en cada medición contra lo que dice la
-- tabla de cubicación, y si difieren más de 2 L le avisa al CHOFER. Existe por una razón buena: si
-- la copia congelada de la PWA se desincroniza de la tabla de la base, hay que enterarse.
--
-- Pero al corregir la cubicación del JAC, TODAS las mediciones viejas quedaron en falta: se
-- guardaron con la recta de 13,043 L/cm, que era lo vigente ese día. Corriendo la auditoría en seco
-- sobre el 09/07 saltaron 25 errores en una flota de 12 camiones — o sea, prácticamente todas. El
-- cron de las 7am les habría mandado un WhatsApp a los choferes reclamándoles por un dato que
-- cargaron bien, con la regla bien leída, el día que la tabla decía otra cosa.
--
-- Esa es exactamente la falla que este módulo viene arrastrando: acusar a una persona por un error
-- del sistema. Corregir la tabla no puede convertir en culpable a nadie retroactivamente.
--
-- LA SOLUCIÓN: la tabla tiene fecha de vigencia. R8 solo compara lo guardado contra la tabla cuando
-- la medición se tomó DESPUÉS de que esa tabla entró en vigor. Lo anterior se sigue recalculando
-- desde la tabla nueva para todos los cálculos de la auditoría (eso está bien y es lo que se quiere),
-- pero no se le reclama a nadie.
--
-- NULL = tabla de siempre, se compara todo (los del galpón, que no cambiaron).

alter table public.combustible_tanques_config
  add column if not exists tabla_desde timestamptz;

comment on column public.combustible_tanques_config.tabla_desde is
  'Desde cuándo rige la tabla_cubicacion actual. R8 no le reclama al chofer por mediciones anteriores a esta fecha: se guardaron con la tabla que estaba vigente entonces. NULL = comparar siempre.';

update public.combustible_tanques_config
   set tabla_desde = '2026-07-25T18:00:00Z'
 where id = 'tanque-jac';

-- Cuando se haga el aforo con bidón y se vuelva a cambiar la tabla, hay que mover esta fecha en el
-- mismo movimiento. Si no, el día después vuelven a saltar 25 falsos reclamos.
