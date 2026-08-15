-- BETANGAR — Los sitios necesitan decir QUÉ SON, no solo si son oficina
-- Fecha: 2026-08-14
--
-- POR QUÉ: hasta hoy `sitios_asistencia` solo distinguía `es_oficina` sí/no, porque
-- la tabla nació para fichar asistencia. Con el GPS aparece un sitio de otra
-- naturaleza — el VERTEDERO — y contar vueltas patio→vertedero→patio exige poder
-- preguntar «¿cuál de estas geocercas es el destino de descarga?». Con un booleano
-- no se puede.
--
-- ⛔ NO se toca `es_oficina`: lo lee la app en varios lados (`renderSitios`,
-- `_qrCardSucursal`, el QR por sucursal). Se AGREGA `tipo` y se rellena a partir de
-- lo que ya había, así nada de lo que hoy funciona cambia de comportamiento.
--
-- ⚠️ SIN restricción de valores a propósito: un catálogo cerrado que rechaza un
-- tipo nuevo trancaría el alta de un sitio en medio de la jornada. Los valores
-- previstos se documentan acá y la app ofrece la lista; la base no tranca.
--   base      → patio / sede de donde salen las unidades
--   oficina   → oficina administrativa (donde se ficha)
--   vertedero → destino de descarga. ES EL QUE CUENTA LAS VUELTAS.
--   cliente   → punto de entrega o recolección de un cliente
--   otro      → cualquier otro punto de interés

begin;

alter table public.sitios_asistencia
  add column if not exists tipo text;

comment on column public.sitios_asistencia.tipo is
  'Qué es este sitio: base | oficina | vertedero | cliente | otro. El vertedero es el que sostiene el conteo de vueltas contra las planillas. Sin restricción de valores: un catálogo cerrado no puede trancar el alta de un sitio.';

-- Rellenar lo que ya existe desde el booleano viejo. Solo donde está vacío, para no
-- pisar nada que alguien haya clasificado a mano si esto se corre dos veces.
update public.sitios_asistencia
   set tipo = case when es_oficina then 'oficina' else 'base' end
 where tipo is null;

-- Los sitios los administra la misma gente que hoy: las policies `sit_ins`,
-- `sit_upd` y `sit_del` ya limitan a superadmin/admin/revisor y no se tocan.
-- La geocerca decide si un viaje se cuenta: no puede moverla cualquiera.

commit;

-- ── VERIFICAR ────────────────────────────────────────────────────────────────
-- select id, nombre, tipo, es_oficina, radio_m, activo from sitios_asistencia order by id;
