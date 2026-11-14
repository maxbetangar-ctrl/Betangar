-- El movimiento del 10/11/2026: gasoil sacado de las unidades al tanque aéreo Galpón 1.
-- Litros DECLARADOS por Máximo el 13/11, unidad por unidad. Total 1.265 L.
--
-- ⛔ LOS LITROS SON LOS DECLARADOS, NO LOS MEDIDOS, y la nota de cada fila lo dice
--    junto con lo que marcó la regla del tanque de esa unidad. Sobre las 8 que se
--    pueden medir, la regla da 1.641 L contra 1.085 declarados: 556 L sin explicar.
--    No se promedia ni se elige uno de los dos — se guarda lo que la gente declaró y
--    se deja ESCRITA la diferencia, para que se pueda revisar en vez de desaparecer.
--    [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
--
-- 📌 Donde la medición es limpia, cuadra: B003 estuvo parado toda la noche (179
--    medidos contra 160 declarados) y B009 cierra en 5 L. Donde el camión trabajó ese
--    día, el medido incluye su consumo real y se infla: por eso no se resta a ciegas.
--
-- B005 (en taller) y B006 (no se le sacó) NO entran — y la regla tampoco los marca,
-- que es el control en el otro sentido.
insert into public.devoluciones_tanque (id, fecha, cam, tanque, litros, motivo, nota, registrado_por) values
  ('DT-2026-11-10-JAC-B001','2026-11-10','JAC-B001','tanque-galpon-1',120,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 278 L de más ese día (el camión trabajó: el medido incluye su consumo)','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B002','2026-11-10','JAC-B002','tanque-galpon-1',160,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 357 L de más ese día (el camión trabajó: el medido incluye su consumo)','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B003','2026-11-10','JAC-B003','tanque-galpon-1',160,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 179 L con el camión PARADO toda la noche — la medición más limpia, 19 L de diferencia','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B004','2026-11-10','JAC-B004','tanque-galpon-1',160,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 229 L de más','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B007','2026-11-10','JAC-B007','tanque-galpon-1',40,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla NO lo ve: 40 L son 3,4 cm y quedan bajo el ruido de la lectura','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B008','2026-11-10','JAC-B008','tanque-galpon-1',140,'traslado al tanque aéreo','declarado por Máximo 13/11; sin lectura de llegada ese día, no verificable. ⚠️ Además registró 600 L en dos surtidas de 300 con un minuto de diferencia, sobre 464 L que ya tenía en un tanque de 600: pendiente de aclarar si fue carga duplicada o transporte','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B009','2026-11-10','JAC-B009','tanque-galpon-1',80,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 74,6 L — cierra en 5 L','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B010','2026-11-10','JAC-B010','tanque-galpon-1',180,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 223 L de más','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B011','2026-11-10','JAC-B011','tanque-galpon-1',165,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 215 L de más','Máximo Betancourt'),
  ('DT-2026-11-10-JAC-B012','2026-11-10','JAC-B012','tanque-galpon-1',60,'traslado al tanque aéreo','declarado por Máximo 13/11; la regla marcó 85 L de más','Máximo Betancourt')
on conflict (id) do nothing;
