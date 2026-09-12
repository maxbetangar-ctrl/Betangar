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

- `aurelys_fuera_de_las_dos_listas_2026-08-16.sql` -- una persona que no aparecia en ninguna de las dos listas -- 4 telefonos
- `aviso_alejandra_cambios_y_prueba_2026-08-18.sql` -- aviso de cambios a una persona de RRHH -- nombre completo
- `consulta_alejandra_tres_activos_2026-08-18.sql` -- consulta por tres activos -- nombre completo
- `quien_recibe_sale_de_la_base_2026-08-27.sql` -- quien recibe los avisos sale de la base -- 2 telefonos
- `recordatorio_surtir_choferes_2026-08-18.sql` -- recordatorio de surtir a los choferes -- varios nombres completos

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
