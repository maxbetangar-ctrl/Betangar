-- ============================================================================
-- QUIÉN MANDA: `activo` vs `en_nomina`   ·  18/08/2026   ·  SOLO BETANGAR
--
-- Por qué existe: hoy me equivoqué. Vi 3 choferes con `activo=false` que manejan
-- todos los días y reporté que eso «los deja fuera de nómina». Máximo lo frenó:
-- Alejandra dice que la nómina cuadra. Tenía razón ella. Y su diagnóstico fue
-- exacto: **hay dos sitios donde mirar y eso confunde.**
--
-- Lo que se comprobó, y por eso queda escrito EN LA TABLA y no en un documento
-- que nadie abre:
--
--   `activo`     → ¿sigue trabajando acá? La leen 128 lugares de `app.js`.
--                  ⛔ NO decide la nómina.
--   `en_nomina`  → en BETANGAR **no la lee NADIE**. Cero referencias en `app.js`
--                  y en `app.html`. Es una columna heredada del molde.
--
-- Y lo que de verdad decide quién cobra en Betangar es OTRA COSA: la PLANILLA.
-- `calcNom` lo dice textual: «Los INACTIVOS se siguen pagando si aparecen en
-- planilla (regla "el viaje siempre se paga") y se marcan ⚠️ en la tabla; el que
-- no aparece en ninguna fila no entra». O sea que ninguna de las dos banderas
-- gobierna el pago: gobierna el trabajo registrado.
--
-- ⚠️ NO SE BORRA `en_nomina`. En los CLONES (FlotaMax) sí se usa, y con un
--    significado propio y bien pensado: «está en el sistema pero NO cobra por
--    esta empresa». Quitarla de Betangar rompería la paridad con el molde y no
--    arreglaría nada — lo que confundía no era que existiera, era que nada
--    dijera que acá está muda.
--
-- Esto no cambia ni un dato ni una conducta: solo hace que la tabla conteste
-- la pregunta que hoy hubo que reconstruir leyendo 128 usos y un motor entero.
-- ============================================================================

comment on column empleados.activo is
  '¿La persona sigue trabajando en la empresa? Es la bandera que leen las listas, '
  'los avisos y el servicio técnico. ⛔ NO DECIDE LA NÓMINA: en Betangar cobra quien '
  'aparece en la PLANILLA, y un inactivo que aparece SE PAGA IGUAL (regla «el viaje '
  'siempre se paga», ver calcNom en app.js) y sale marcado con ⚠️. Si alguien está '
  'en false y aun así trabaja, lo que está mal es este campo — la nómina no se entera.';

comment on column empleados.en_nomina is
  '⛔ EN BETANGAR NO LA LEE NADIE (verificado 18/08/2026: cero referencias en app.js y '
  'app.html). Existe porque viene del molde. NO la uses para saber si alguien cobra: '
  'acá eso lo decide la PLANILLA. En los CLONES de FlotaMax sí gobierna, y ahí significa '
  '«está en el sistema —mensajes, reportes, personal— pero NO cobra por esta empresa». '
  'Si algún día Betangar necesita esa distinción, hay que ENCENDERLA a propósito en el '
  'código, no dar por hecho que ya funciona.';

comment on table empleados is
  'Personal. ⚠️ Para saber QUIÉN COBRA no mires esta tabla: en Betangar lo decide la '
  'PLANILLA (REGS) a través de calcNom. Acá `activo` dice si la persona sigue trabajando '
  'y `en_nomina` está muda (ver el comentario de cada columna).';
