-- ════════════════════════════════════════════════════════════════════════════════════════
-- SANEAR LOS TANQUES IMPOSIBLES          2026-08-17
--
-- Se corre en LAS CUATRO bases aunque hoy solo Flotilla tenga el problema: los cinco productos
-- salieron del mismo molde y del mismo código, así que lo que ensució a uno pudo ensuciar a
-- cualquiera. Donde no hay nada que arreglar, esto no toca ni una fila.
--
-- QUÉ PASÓ: FC16 (MACK GU813) quedó cargado con un tanque de 8.639 cm de diámetro —86 metros—
-- y 8.909.645 litros. Se le fue la coma al teclear y nada lo frenó: la verificación que existía
-- corría solo para la forma 'redondeado' y solo si se declaraba la capacidad de fábrica.
-- El candado ya se cerró en `cubicacion.js` (medidaImposible), pero el dato viejo sigue haciendo
-- daño, y no en un lugar sino en TRES:
--   1. la tabla de cubicación del tanque;
--   2. `unidad_config.capacidad_tanque_l`, que quedó en 8.909.645 L y marcado como 'medido';
--   3. 7 mediciones que el chofer YA cargó, a las que el sistema les calculó hasta 222.419 L.
--
-- ⛔ LO QUE NO SE BORRA: la medición del chofer en CENTÍMETROS. Esa es real —él puso la regla en
-- el tanque— y sirve igual para ver si el nivel se movió entre dos lecturas. Lo que se anula es
-- el litraje que el sistema DEDUJO de una tabla falsa. Un dato inventado se quita; el que se
-- midió, se respeta.
--
-- ⛔ TAMPOCO SE BORRA EL TANQUE: se ARCHIVA (activo=false) con la nota de por qué. Borrarlo
-- perdería las medidas que Carlos tomó y no habría cómo saber de dónde salió el disparate.
-- Mientras esté archivado, `tanque_de_unidad('FC16')` devuelve NULL y el chofer guarda sus
-- centímetros SIN litros — que es exactamente lo correcto hasta que alguien lo vuelva a medir.
-- ════════════════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · El tanque imposible se archiva ──────────────────────────────────────────────────────
-- El WHERE nombra la condición absurda, no la unidad: así sirve en las cuatro bases y no puede
-- tocar por error un tanque que esté bien.
update public.combustible_tanques_config
   set activo = false,
       nombre = nombre || ' — ARCHIVADO 2026-08-17 (medida imposible)'
 where coalesce(activo, true)
   and (   coalesce(altura_max_cm,0)    > 260
        or coalesce(altura_max_cm,0)    < 10
        or coalesce(capacidad_litros,0) > 60000
        or coalesce(capacidad_litros,0) < 20 )
   and nombre not like '%ARCHIVADO 2026-08-17%';

-- ⚠️ LOS PASOS 2 Y 3 VAN CONDICIONADOS A QUE LA COLUMNA EXISTA.
-- La primera corrida murió en `flotamax-demo` con «column u.capacidad_tanque_l does not exist», y
-- al mirar por qué apareció lo de fondo: las cuatro bases NO tienen el mismo esquema. Esa
-- instancia está atrasada en 7 tablas (unidad_config 23 columnas contra 26, rutas 6 contra 10,
-- le falta `mant_solicitudes` entera). Como todo está dentro de una transacción, ese error hizo
-- rollback de TODO el saneamiento de esa base — un tanque imposible ahí habría quedado sin limpiar
-- y el `✅ ejecutado` de las otras tres tapaba el hueco.
-- Una migración que da por hecho que todas las instancias son iguales falla justo en la que más
-- divergió, que es la que más lo necesita.

-- ── 2 · La capacidad que se le copió a la unidad ────────────────────────────────────────────
-- Había quedado como 'medido', que es la marca de más confianza que existe en el sistema.
do $paso2$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='unidad_config'
                and column_name='capacidad_tanque_l') then
    execute $q$
      update public.unidad_config u
         set capacidad_tanque_l = null,
             capacidad_origen   = null,
             capacidad_fuente   = 'Anulada 2026-08-17: venia de una cubicacion con medidas imposibles. Falta volver a medir el tanque.'
       where coalesce(u.capacidad_tanque_l,0) > 60000
          or exists (select 1 from public.combustible_tanques_config t
                      where t.vehiculo_id = u.cam
                        and t.activo = false
                        and t.nombre like '%ARCHIVADO 2026-08-17%'
                        and u.capacidad_tanque_l = t.capacidad_litros)
    $q$;
  else
    raise notice 'unidad_config.capacidad_tanque_l no existe en esta instancia: paso 2 omitido.';
  end if;
end
$paso2$;

-- ── 3 · Los litros que el sistema le inventó a las mediciones del chofer ────────────────────
-- La altura en cm NO se toca: esa la midió una persona con la regla.
do $paso3$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='combustible_mediciones'
                and column_name='litros_calculados') then
    execute $q$
      update public.combustible_mediciones m
         set litros_calculados = null,
             notas = coalesce(notas,'') || ' | Litros anulados 2026-08-17: salian de una tabla de cubicacion imposible. La medida en cm se conserva.'
       where m.litros_calculados is not null
         and exists (select 1 from public.combustible_tanques_config t
                      where t.vehiculo_id = m.vehiculo_id
                        and t.activo = false
                        and t.nombre like '%ARCHIVADO 2026-08-17%')
    $q$;
  else
    raise notice 'combustible_mediciones.litros_calculados no existe en esta instancia: paso 3 omitido.';
  end if;
end
$paso3$;

commit;

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────────────────────
-- Que dé cero no prueba nada si el control no detecta. Antes de creerle al vacío, el control
-- positivo ya corrió: la misma consulta encontró FC16 en Flotilla y no lo encontró en las otras
-- tres, así que sabemos que MIRA.
--   select vehiculo_id, activo, altura_max_cm, capacidad_litros
--     from public.combustible_tanques_config
--    where coalesce(altura_max_cm,0) > 260 or coalesce(capacidad_litros,0) > 60000;
--   -- deben quedar todos con activo = false
--
--   select count(*) from public.combustible_mediciones where litros_calculados > 60000;  -- 0
--   select count(*) from public.unidad_config       where capacidad_tanque_l > 60000;    -- 0
