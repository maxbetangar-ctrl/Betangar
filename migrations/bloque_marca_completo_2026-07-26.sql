-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE DE MARCA COMPLETO — familia FlotaMax  (norma 2026-07-26)
--
-- `configuracion` es clave/valor, asi que la marca va como UNA fila clave='marca'
-- con un JSON — el mismo patron que ya usa 'wassenger'.
--
-- ⚠️ ESTO ES LA MITAD DEL TRABAJO. Hoy la marca de un clon vive en BTG_CONFIG
-- dentro de app.js (empresa_nombre, empresa_marca, logo, favicon, accent). Esta
-- fila le da a esos datos un sitio EN LA BASE para que la Torre pueda escribirlos
-- al importar el Excel de alta; falta que app.js los LEA de aqui en vez de
-- tenerlos escritos. Mientras tanto manda BTG_CONFIG.
--
-- Idempotente: si la fila ya existe no la pisa.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.configuracion (clave, valor)
select 'marca', json_build_object(
  'nombre', '', 'razon_social', '', 'rif', '', 'direccion', '', 'ciudad', '', 'estado', '',
  'telefono', '', 'telefono_interno', '', 'email', '', 'sitio_web', '', 'instagram', '',
  'nombre_corto', '', 'color_primario', '', 'color_acento', '', 'lema', '',
  'folio_prefijo', '', 'logo_url', '', 'icono_url', ''
)::text
where not exists (select 1 from public.configuracion where clave = 'marca');
