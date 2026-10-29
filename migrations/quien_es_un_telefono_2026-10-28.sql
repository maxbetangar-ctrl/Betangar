-- ════════════════════════════════════════════════════════════════════════════════════════════
-- DE QUIÉN ES ESTE TELÉFONO — Betangar · 28/10/2026
--
-- 🔬 POR QUÉ. El acuse del resumen decía «salió para …1298» en vez de «salió para JONAZ»: los
--    nombres de `configuracion.whatsapp` están todos en NULL. El reflejo era escribirlos ahí.
--
-- ⛔ ESCRIBIRLOS AHÍ HABRÍA SIDO UNA SEGUNDA LISTA. Los cuatro ya están declarados en las tablas
--    de personas —`empleados` y `torre_contactos`—, así que copiarlos a la config crea dos
--    sitios que se desincronizan: el día que alguien cambie un teléfono en la ficha, el aviso
--    seguiría nombrando a la persona equivocada. Y esta casa ya perdió 103 mensajes por tener el
--    dato mal en UN solo sitio. [[norma-dos-listas-a-mano-se-desincronizan]]
--    Medido antes de escribir nada: los 4 resuelven desde las tablas que ya existen.
--
-- ⛔ SE COMPARA POR LOS ÚLTIMOS 10 DÍGITOS, no por el texto. El mismo teléfono está escrito de
--    seis formas distintas en esta base: con +58, con 0058, con 0414, con guiones y con espacios.
--    Comparar cadenas daría «no lo conozco» para un número que sí está cargado, y eso se lee
--    igual que «ese número no es de nadie». [[norma-contar-digitos-no-prueba-nada]]
--
-- ⛔ Y SI NO LO CONOCE, DEVUELVE NULL. Quien llama decide qué poner —el acuse pone los últimos 4
--    dígitos—. Inventar un nombre acá sería peor que no saberlo.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.btg_quien_es_tel(p_tel text)
returns text language sql stable as $fn$
  with d as (select right(regexp_replace(coalesce(p_tel,''), '\D', '', 'g'), 10) cola)
  select nullif(trim(coalesce(
    -- 1º el padrón de personal: es el que la empresa mantiene al día
    (select e.nombre from empleados e, d
      where length(d.cola) = 10
        and regexp_replace(coalesce(e.whatsapp, e.tel, ''), '\D', '', 'g') like '%' || d.cola
      limit 1),
    -- 2º los contactos de la Torre: ahí viven los que NO son empleados (socios, proveedores)
    (select t.nombre from torre_contactos t, d
      where length(d.cola) = 10
        and regexp_replace(coalesce(t.telefono, ''), '\D', '', 'g') like '%' || d.cola
      limit 1)
  )), '')
$fn$;

comment on function public.btg_quien_es_tel(text) is
  'De quién es un teléfono, buscándolo en `empleados` y después en `torre_contactos` por los últimos 10 dígitos —el mismo número está escrito de seis formas en esta base—. ⛔ Devuelve NULL cuando no lo conoce, para que quien llama ponga lo que sepa (los últimos 4 dígitos) en vez de un nombre inventado. ⛔ No se copian nombres a `configuracion.whatsapp`: sería una segunda lista que se desincroniza de la ficha.';

revoke execute on function public.btg_quien_es_tel(text) from public, anon;
grant  execute on function public.btg_quien_es_tel(text) to authenticated, service_role;
