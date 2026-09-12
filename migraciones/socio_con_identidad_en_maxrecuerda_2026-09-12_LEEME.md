# El socio con identidad en MaxRecuerda · 12/09/2026 · APLICADO

**El `.sql` NO está en este repo, a propósito.** Vive en el repo **privado**:

```
maxware-tools/supabase/socio_con_identidad_en_maxrecuerda_2026-09-12.sql
```

## Por qué no está acá

⛔ **Este repo es PÚBLICO y GitHub Pages sirve `migraciones/` y `migrations/`
tal cual.** Comprobado el 12/09/2026 con `curl`: la API de GitHub devuelve 200
sin autenticar, y varios `.sql` de estas dos carpetas dan **200 en
`betangar.com`** — cualquiera los baja escribiendo la ruta.

Esa migración da de alta a una persona con **nombre y teléfono**. Publicarlos no
hace falta para nada: lo que este repo necesita registrar es **qué se aplicó**,
no **con qué datos**.

## Qué se aplicó (sin datos de nadie)

1. Una fila nueva en `empleados` — **cargo «Socio»**, `activo = true`,
   `en_nomina = false`. Es la primera fila de Betangar con `en_nomina` en falso.
2. El puente `btg_usuarios.empleado_id` de esa cuenta, apuntando a esa fila, para
   que `rec_quien_soy()` la identifique por **dato declarado** y no por cruce de
   nombres.
3. `comment on column empleados.en_nomina` actualizado: ahora dice que hay filas
   en `false` a propósito y que, **por estar muda esa columna en Betangar**, esas
   personas **sí** aparecen en las listas de personal y en el contador del
   tablero.

## Lo que hay que saber antes de tocar esto

⚠️ `en_nomina` **no la lee nadie en Betangar** (0 referencias en `app.js` y
`app.html`; verificado el 18/08 y de nuevo el 12/09). Ya lo advertía
`activo_vs_en_nomina_quien_manda_2026-08-18.sql`. Poner `false` **no deja a nadie
afuera de ninguna lista** — para eso hay que **encender el filtro en el código**.

⏳ Consecuencia abierta: **«marcar todos presentes» le pone asistencia al socio.**
`app.js` filtra por `cargo` y solo excluye *Gerente General* y *Administrador*.
Y de paso, esa línea **dice que excluye a los administradores y no lo hace**:
compara con `'Administrador'` mientras en la tabla el cargo cargado es
`'Administradora'`.

## Norma que sale de acá

**Una migración que nombra personas no se versiona en un repo público.** El `.sql`
va al repo privado; acá queda este puntero, que dice qué corrió y cuándo sin
publicar a nadie. Antes de versionar cualquier archivo con gente adentro:
`curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/<owner>/<repo>`
— un **200 sin autenticar significa PÚBLICO**.
