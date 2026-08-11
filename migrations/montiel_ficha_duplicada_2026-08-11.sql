-- ⛔ UNA PERSONA, UNA FICHA — y una ficha con la cuenta de OTRO.
-- Fecha: 2026-08-11 · Decisión de Máximo: «él es E706, puedes borrar el E342».
--
-- POR QUÉ. Alejandra (QA) reportó a CARLOS ALFREDO MONTIEL VILLALOBOS **duplicado** en la nómina de
-- la semana 23: una fila con sus viajes correctos y otra con dos viajes del lunes que no le
-- correspondían. Había DOS fichas activas con el MISMO nombre:
--
--   E342 · sin cédula      · unidad JAC-B008 · ingreso 09/07 · cuenta 0102-0345-75-0001027024
--   E706 · V-19307663      · unidad JAC-B005 · ingreso 14/07 · cuenta 0102-0535-29-0000902577
--
-- Y el duplicado no era solo cosmético: con dos fichas del mismo nombre, `_empPorNombre` devuelve
-- NULL a propósito (el sistema no elige entre dos personas), así que NINGUNA cobraba por nombre y
-- las DOS caían en el respaldo «pagar por la unidad de la ficha». Ese respaldo se eliminó hoy en
-- `calcNom` — «si no figura en la planilla, no cobra».
--
-- 🚨 HALLAZGO APARTE, y es el más grave: la cuenta de la ficha E342 **no es de él**. Esa misma
-- cuenta `0102-0345-75-0001027024` figura en `pagos_bnc` a nombre de ALEXANDER ARTURO PAZ GONZALEZ
-- ($110, 22/07/2026). Una ficha con la cuenta de otra persona es un pago al destinatario equivocado
-- esperando a ocurrir. No llegó a pasar: no hay NINGÚN pago a nombre de Montiel en `pagos_bnc`.
--
-- COMPROBADO ANTES DE BORRAR: 0 filas apuntan a 'E342' en las 36 columnas del esquema que pueden
-- referenciar a un empleado, y 0 claves foráneas hacia `empleados`. El borrado no huerfaniza nada.
-- Sus viajes reales viven en las planillas POR NOMBRE, así que no se pierden: pasan a E706.
--
-- 📋 LA FILA COMPLETA, POR SI HAY QUE VOLVER (el borrado es lo único irreversible de esta sesión):
--   id: E342 · nombre: CARLOS ALFREDO MONTIEL VILLALOBOS · cargo: Ayudante · unidad: JAC-B008
--   cedula: (vacía) · activo: true · fingreso: 2026-07-09 · tel: +584146905246
--   banco: Banco de Venezuela · tipo: (n/d) · ncuenta: 0102-0345-75-0001027024
--   created_at / updated_at: 2026-07-11 18:47:14.367726+00
--
-- [[norma-un-nombre-paga-a-una-sola-ficha]] [[norma-nombre-corto-que-apunta-a-dos-personas]]
-- [[norma-identificacion-tipo-aparte-y-normalizada]]

begin;

-- 1) La unidad de la ficha buena, a donde realmente trabaja. Las 7 planillas de la semana 23 lo
--    ponen en el JAC-B012, no en B005 ni en B008. La unidad de la ficha ya no PAGA nada (se quitó
--    el respaldo), pero sigue siendo el dato con el que RRHH lo busca.
update public.empleados set unidad = 'JAC-B012', updated_at = now() where id = 'E706';

-- 2) Fuera la duplicada. Se exige que siga sin cédula y con el nombre esperado: si alguien la
--    corrigió entre medio, esto no borra nada y se ve en el conteo.
delete from public.empleados
 where id = 'E342'
   and nombre = 'CARLOS ALFREDO MONTIEL VILLALOBOS'
   and coalesce(nullif(btrim(cedula), ''), '') = '';

commit;

-- Comprobación: debe quedar UNA sola ficha con ese nombre, con cédula y en JAC-B012.
select id, nombre, cedula, unidad, activo
  from public.empleados
 where nombre ilike '%CARLOS ALFREDO MONTIEL%'
 order by id;
