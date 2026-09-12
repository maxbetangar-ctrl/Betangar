# Migraciones que se movieron al repo PRIVADO · 12/09/2026

(!) **Este repo es PUBLICO y GitHub Pages sirve esta carpeta por su ruta.**
Comprobado con `curl`: `api.github.com/repos/maxbetangar-ctrl/Betangar` responde
**200 sin autenticar**, y un `.sql` de aca daba **200 en `betangar.com`**.
Cualquiera los bajaba escribiendo la ruta.

Los archivos de esta lista daban de alta, corregian o nombraban a **personas**
-nombre completo, telefono- y por eso **ya no estan aca**. Estan enteros, sin
recortar, en el repo privado:

```
maxware-tools/supabase/betangar-con-personas/
```

Lo que se movio de esta carpeta, y que hacia cada uno:

- `alejandro_castillo_whatsapp_ingresos_2026-08-13.sql` -- el WhatsApp de los ingresos al banco -- telefono del socio
- `bnc_clasificacion_2_entidades_2026-08-08.sql` -- clasificacion de entidades del banco -- un nombre completo
- `montiel_ficha_duplicada_2026-08-11.sql` -- una ficha duplicada -- nombre completo y telefono
- `montiel_una_sola_ficha_2026-08-05.sql` -- dejar una sola ficha -- dos nombres completos
- `planillas_alexander_chofer_2026-08-04.sql` -- planillas de un chofer -- dos nombres completos
- `roster_desalineado_planillas_2026-08-06.sql` -- el roster corrido contra las planillas -- tres nombres completos
- `usuario_arianny_auditora_2026-08-11.sql` -- alta de una cuenta de auditora -- nombre completo
- `wa_lista_blanca_anon_2026-08-02.sql` -- lista blanca de destinos de WhatsApp -- telefonos propios

(!) **Que esto NO resuelve:** salieron del arbol, asi que `betangar.com` **deja de
servirlos**, pero **siguen en el historial publico de git**. Sacarlos de ahi es
reescribir historia o cambiar la visibilidad del repo -que es el que sirve el
dominio- y eso lo decide Maximo. Anotado en `SEGURIDAD_ESTADO.md`.

**La norma, para el proximo:** una migracion que nombra personas no se versiona
en un repo publico. El `.sql` va al privado y aca queda una nota. Antes de
`git add` de cualquier archivo con gente adentro:

```bash
curl -s -o /dev/null -w "%{http_code}
" https://api.github.com/repos/<owner>/<repo>
curl -s -o /dev/null -w "%{http_code}
" https://<dominio>/<ruta-del-archivo>
```

**200 sin autenticar = PUBLICO.**
