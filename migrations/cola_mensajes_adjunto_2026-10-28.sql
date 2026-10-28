-- ════════════════════════════════════════════════════════════════════════════════════════════
-- LA COLA APRENDE A MANDAR UN ADJUNTO — Betangar · 28/10/2026
--
-- 🔬 POR QUÉ. `cola_mensajes` solo sabía texto. Todo informe en PDF de esta casa se mandó hasta
--    hoy A MANO, corriendo `enviar-whatsapp-archivo.mjs` desde la PC de Máximo. Eso significa
--    que un informe automático no puede llevar documento, y que el día que la PC está apagada
--    no sale nada — sin que nadie se entere, que es lo peor.
--
-- 📌 SE AGREGA EL MECANISMO, NO EL CASO. [[norma-arreglar-el-mecanismo-no-el-caso]] No es una
--    columna para el resumen de los socios: es la capacidad de adjuntar, que a partir de hoy
--    tiene CUALQUIER aviso de la cola — el informe mensual, la requisición, el acta.
--
-- ⛔ GUARDA EL ID DEL PROVEEDOR, NO EL ARCHIVO. Wassenger no recibe bytes en el mismo POST que
--    el mensaje: primero se sube a /v1/files y se referencia por su id. Meter el PDF en base64
--    en esta tabla haría filas de megabytes que el worker tiene que leer en cada vuelta, y la
--    cola se procesa cada 3 minutos.
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table public.cola_mensajes
  add column if not exists media_file   text,
  add column if not exists media_nombre text;

comment on column public.cola_mensajes.media_file is
  'El id que devolvió Wassenger al subir el archivo a /v1/files. Cuando está puesto, el worker manda el mensaje CON el documento adjunto y `mensaje` pasa a ser el pie. ⛔ No guarda el archivo: guarda su id en el proveedor.';
comment on column public.cola_mensajes.media_nombre is
  'El nombre con el que la persona ve el adjunto en su WhatsApp. Solo para que el registro diga qué se mandó: el nombre real lo fijó la subida.';
