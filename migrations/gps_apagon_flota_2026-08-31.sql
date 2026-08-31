-- ════════════════════════════════════════════════════════════════════════════
--  gps_apagon_flota — 31/08/2026
--
--  POR QUÉ EXISTE
--  El 31/08 ocho de las diez unidades se callaron dentro de la misma hora con el
--  motor encendido: 21,3 km de flota sin una sola posición. Tres de ellas se
--  callaron en minutos distintos (08:35, 08:52, 09:02) y volvieron TODAS en el
--  mismo minuto: 09:40. Tres equipos independientes no se reconectan al mismo
--  minuto por casualidad — eso es la plataforma del proveedor trabándose, no los
--  aparatos.
--
--  `gps-vigilante` no lo vio y no podía verlo: mira unidad por unidad con un
--  umbral de 5 horas. Un apagón de 65 minutos le pasa por debajo, y aunque se le
--  bajara el umbral mandaría ocho avisos que hacen ir a revisar ocho equipos
--  sanos. Lo que faltaba no era un número más chico: era la mirada de FLOTA.
--
--  ⛔ Y el aviso NO va para adentro. Un apagón del proveedor lo tiene que saber el
--  proveedor: el destinatario es su contacto, con copia a la dueña de la
--  operación. Por eso el número vive acá y no en el código — a quién se le
--  escribe no lo decide quien dispara.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El destinatario ───────────────────────────────────────────────────────
-- ⛔ El número se guarda YA NORMALIZADO por `tel_para_escribir()`, que es la única
-- pieza que decide si a un teléfono se le puede escribir por WhatsApp. Guardar el
-- crudo obligaría a la función a normalizar, y entonces habría dos lugares que
-- opinan sobre lo mismo. Si `tel_para_escribir` devolviera NULL, el insert falla
-- por el CHECK de abajo y el problema se ve ahora y no el día del apagón.
-- ⛔⛔ EL TELÉFONO DE LA PERSONA DEL PROVEEDOR NO VA EN ESTE ARCHIVO.
--
--  El repositorio `Betangar` es PÚBLICO (sirve betangar.com por GitHub Pages, y de
--  los 20 de la cuenta es el único que no es privado). Un número de teléfono de una
--  persona de carne y hueso escrito acá queda expuesto — y, como la clave del BNC
--  que se sacó del código esta misma mañana, **borrarlo después no lo saca del
--  historial de git**. Es el mismo error con otro dato: uno es una credencial, el
--  otro es el celular de alguien que no eligió estar publicado.
--
--  Así que este archivo crea la fila VACÍA y documenta su forma. El número se carga
--  aparte, contra la base, y no se escribe en ningún archivo versionado:
--
--    update configuracion
--       set valor = jsonb_build_object(
--             'tel',    tel_para_escribir('<el número>'),
--             'nombre', '<quién es>',
--             'de',     '<qué proveedor>')::text
--     where clave = 'gps_proveedor_tel';
--
--  ⚠️ `tel_para_escribir()` es la ÚNICA pieza que decide si a un teléfono se le
--  puede escribir por WhatsApp, y devuelve NULL cuando no sabe. Por eso el número
--  se guarda YA NORMALIZADO por ella: si guardara el crudo, habría dos lugares
--  opinando sobre lo mismo. Y `gps-vigilante` avisa para adentro cuando esta fila
--  está vacía — un destinatario que falta no puede parecer una noche sin novedad.
--
-- ⚠️ `configuracion.valor` es TEXT, no jsonb (medido, no supuesto): el objeto se
-- guarda serializado, igual que `alarma_tel`, y quien lo lee lo parsea.
insert into public.configuracion (clave, valor)
values (
  'gps_proveedor_tel',
  jsonb_build_object(
    'tel',    null,
    'nombre', null,
    'de',     null,
    'nota',   'Contacto del proveedor de rastreo. Recibe el aviso de apagón de flota. Cargar el número a mano: NO se versiona.'
  )::text
)
on conflict (clave) do nothing;


-- ── 2. Quién está muda CON EL MOTOR ENCENDIDO, ahora mismo ───────────────────
--
--  ⚠️ EL MOTOR ENCENDIDO ES LA MITAD DE LA MEDIDA, y es la que evita el aviso que
--  salta siempre. Parado y apagado en el patio el equipo reporta 1 vez por hora:
--  contando esos, la flota entera figura muda todas las noches. Lo que importa es
--  el rato en que el camión ANDABA y no supimos dónde — el único que puede
--  esconder una vuelta al vertedero. Misma decisión que `gps_dia.hueco_max_min`.
--
--  ⚠️ Y LA VENTANA TIENE TECHO A PROPÓSITO (p_max_h, por omisión 5 horas).
--  Un equipo que se muere con el motor encendido queda «mudo andando» para
--  siempre: sin techo, cinco aparatos rotos dejarían la alarma de apagón sonando
--  eternamente sobre una flota que no tiene ningún apagón. El techo es 5 h para
--  que encastre EXACTO con `HS_MUDO` de `gps-vigilante`: de 10 min a 5 h lo mira
--  esta función, de 5 h en adelante lo mira el vigilante unidad por unidad. Sin
--  hueco entre las dos y sin que las dos avisen de lo mismo.
create or replace function public.gps_mudas_andando(
  p_min_mudez int default 10,
  p_max_h     int default 5
)
--  ⚠️ NO DEVUELVE LA PLACA, y no es un olvido. El aviso sale hacia AFUERA y del
--  otro lado la unidad se busca por la grafía de ELLOS (JAC-B008: nuestro carnet
--  dice A04EO1P y su plataforma la llama AO4E01P), así que la placa hace falta —
--  pero la resuelve `gps-vigilante`, que ya lee `gps_equipos` entera para sus
--  otros tres chequeos. Agregarla acá obligaba a un DROP de una función viva, y
--  un dato que ya está a mano no justifica borrar nada.
returns table (cam text, ultimo timestamptz, min_mudo int)
language sql
stable
security definer
set search_path = public
as $$
  with ult as (
    select distinct on (p.cam) p.cam, p.ts, p.ignicion
      from gps_posiciones p
      join gps_equipos e on e.cam = p.cam and e.activo
     where p.ts > now() - (p_max_h || ' hours')::interval
     order by p.cam, p.ts desc
  )
  select u.cam,
         u.ts,
         (extract(epoch from (now() - u.ts)) / 60)::int
    from ult u
   where u.ignicion
     and extract(epoch from (now() - u.ts)) / 60 >= p_min_mudez
   order by u.ts;
$$;

comment on function public.gps_mudas_andando(int, int) is
  'Unidades activas cuyo último reporte tiene el motor encendido y ya es viejo: el camión anda y no sabemos dónde. La usa gps-vigilante para distinguir un apagón de FLOTA (varias a la vez = el proveedor) de un equipo roto (una sola).';

revoke all on function public.gps_mudas_andando(int, int) from public, anon;
grant execute on function public.gps_mudas_andando(int, int) to service_role;


-- ── 3. El umbral, en la configuración y no en el código ──────────────────────
--
--  ⚠️ MEDIDO, NO ELEGIDO. Sobre los 3 días que hay con las 10 unidades, contando
--  como lo puede contar una alarma EN VIVO —una unidad recién se sabe muda
--  después de sus 10 minutos de silencio, no desde el primer minuto que falta—:
--
--    5 o más a la vez  ->  0 avisos. NO habría visto el apagón del 31/08.
--    4 o más a la vez  ->  1 aviso, exactamente el del 31/08 (09:36, 5 min).
--    3 o más a la vez  ->  el mismo apagón, entrando 16 minutos antes.
--
--  ⛔ El pico de 5 que se dijo primero salió de contar HACIA ATRÁS, con los huecos
--  ya cerrados. Un hueco se conoce entero recién cuando la unidad vuelve; la
--  alarma no tiene ese dato mientras el apagón ocurre. Contar así habría fijado
--  el umbral en un número que no se alcanza nunca en vivo.
--
--  Queda en 4. Vive acá y no en el código para que moverlo sea una fila y no un
--  despliegue.
insert into public.configuracion (clave, valor)
values ('gps_apagon_umbral', jsonb_build_object('unidades', 4)::text)
on conflict (clave) do update set valor = excluded.valor, updated_at = now();
