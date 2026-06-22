# Clonar Betangar para una empresa nueva (modelo "instancia por empresa")

Cada cliente = su **propio Supabase** (datos aislados) + su **propio deploy**, controlado
por la tabla `licencias` CENTRAL (kill-switch). Aislamiento real de datos (**ISO 27001**:
confidencialidad) e instalación repetible (**ISO/IEC 25010**: flexibilidad/instalabilidad).

## 1. Base de datos del cliente (Supabase nuevo)
1. Crea un proyecto Supabase nuevo (la base de ESA empresa). Anota **URL**, **anon key** y
   **service_role key** (Settings → API).
2. Copia el ESQUEMA de Betangar a esa base. Desde la base central `hrkjddehqnzcqwlkklqm`:
   `supabase db dump --schema public --schema-only > esquema.sql` (o `pg_dump --schema-only`)
   y córrelo en el proyecto nuevo. Incluye TODAS las tablas (planillas, viajes_chofer,
   checklist, empleados, abonos, gasoil, km_data, flota_estado, cxp, proveedores, prestamos,
   multas, inventario, contratos, gastos_variables, pagos_alcaldia, rutas_estado, porteria,
   configuracion, health_check, etc.) **con sus constraints y políticas RLS**.
3. ⚠️ Las tablas deben tener su policy `anon USING(true) WITH CHECK(true)` (la app corre como
   anónima para los datos). Si el dump las trae, listo; si no, créalas (ver CLAUDE.md).
4. Corre **`migrations_btg_usuarios.sql`** en la base nueva (tabla `btg_usuarios` para el login).

## 2. Usuarios del cliente (login con Supabase Auth — sin claves en el HTML)
El login es 100% Supabase Auth: las claves viven cifradas en Auth, **NO** en el código.
El panel "🔐 Usuarios" de la app crea usuarios en la base CENTRAL, así que para la instancia
del cliente se siembran con el script (corre en TU máquina, con el service_role del cliente):

1. Crea un `usuarios.json` con los logins/roles del cliente (ver ejemplo en `seed-usuarios.mjs`).
2. PowerShell:
   ```
   $env:BTG_URL="https://XXXX.supabase.co"          # del cliente
   $env:BTG_SERVICE_ROLE="eyJ...service_role..."     # del cliente (NO se comitea)
   node seed-usuarios.mjs usuarios.json
   ```
3. Borra `usuarios.json` (tiene claves). El script es idempotente: re-correrlo actualiza claves.
   Después, desde la app del cliente, el superadmin ya puede gestionar usuarios en 🔐 Usuarios
   (esa gestión apunta a la central; para clones, seguir usando el script o adaptar la API).

## 3. Deploy del cliente (su copia de la app)
1. Clona este repo (o copia app.html, chofer.html, index.html, chofer-sw.js, chofer-manifest.json).
2. **app.html** → bloque `BTG_CONFIG`: `data_url`/`data_key` = Supabase del cliente.
   NO toques `lic_url`/`lic_key` (SIEMPRE la CENTRAL). Pon `licencia_ref` y `empresa_nombre`.
3. **chofer.html** → bloque `BTG_CHOFER_CONFIG`: `data_url`/`data_key` del cliente.
4. Ajusta la flota: `var FLOTA` (app.html) y `var FLOTA_CHOFERES` (chofer.html) con sus camiones/choferes.
5. (Opcional) `var USUARIOS` queda solo con rol/nombre para la UI; **sin claves** (el login es Auth).
6. Despliega (GitHub Pages / Vercel) y apunta el dominio del cliente a ese deploy.

## 4. Licencia (en el panel central de Geppetto)
1. Panel SaaS → 🧾 Licencias → **🚀 Onboard cliente** → producto **Betangar**.
2. Usa el mismo `ref_id` que pusiste en `BTG_CONFIG.licencia_ref` y el **dominio** del cliente.
3. Define plan/precio/cortesía. Cobra/renueva desde ahí; si no paga, lo suspendes y su app
   muestra "Acceso suspendido" (el kill-switch lee la licencia CENTRAL por dominio o ref).

## Checklist de salida (verificación POST — QA / ISO 25010)
- [ ] Login Auth entra (probar un usuario sembrado).
- [ ] 🩺 Salud de Datos: "Escritura a la base 🟢 GUARDA OK" (heartbeat real).
- [ ] Dashboard carga datos (no 0 filas → RLS anon OK).
- [ ] chofer.html sincroniza un viaje de prueba.
- [ ] Licencia activa; al suspenderla, la app bloquea.

## Notas
- **Aislamiento REAL**: la base del cliente es independiente; imposible ver datos de otro (ISO 27001).
- **Control central**: una sola tabla `licencias` y un solo panel cobran/suspenden a TODOS.
- **Storage**: Betangar no sube archivos → no hay buckets que asegurar (si algún día se añaden,
  usar bucket privado + URLs firmadas, ver el patrón de Geppetto).
- **Costo**: Supabase free alcanza para empresas chicas; Pro (~$25/mes) si crecen — lo cubre la licencia.
- Si algún día prefieres multi-tenant compartido, se migra (tenant_id + Auth + RLS); hoy no hace falta.
