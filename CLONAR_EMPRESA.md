# Clonar Betangar para una empresa nueva (modelo "instancia por empresa")

Cada cliente = su **propio Supabase** (datos aislados) + su **propio deploy**, controlado
por la tabla `licencias` CENTRAL (kill-switch). Pasos:

## 1. Base de datos del cliente (Supabase nuevo)
1. Crea un proyecto Supabase nuevo (la base de ESA empresa).
2. Copia el esquema de Betangar a esa base. Exporta el esquema actual con:
   `supabase db dump --schema public --schema-only` (o pg_dump --schema-only) desde la base
   central `hrkjddehqnzcqwlkklqm`, y córrelo en el proyecto nuevo. Incluye las tablas
   (planillas, viajes_chofer, checklist, empleados, abonos, gasoil, km_data, flota_estado,
   cxp, proveedores, prestamos, multas, inventario, contratos, gastos_variables,
   pagos_alcaldia, rutas_estado, porteria, configuracion, etc.) + sus constraints/RLS.
3. Anota la **URL** y la **anon key** del proyecto nuevo.

## 2. Deploy del cliente (su copia de la app)
1. Clona este repo (o copia app.html, chofer.html, index.html, chofer-sw.js, chofer-manifest.json).
2. En **app.html** → bloque `BTG_CONFIG`: pon `data_url`/`data_key` del Supabase del cliente.
   NO toques `lic_url`/`lic_key` (siempre la CENTRAL). Pon `licencia_ref` y `empresa_nombre`.
3. En **chofer.html** → bloque `BTG_CHOFER_CONFIG`: pon `data_url`/`data_key` del cliente.
4. Ajusta la flota del cliente: `var FLOTA` (app.html) y `var FLOTA_CHOFERES` (chofer.html)
   con sus camiones y choferes.
5. Despliega (GitHub Pages / Vercel) y apunta el dominio del cliente a ese deploy.

## 3. Licencia (en el panel central de Geppetto)
1. Panel SaaS → 🧾 Licencias → **🚀 Onboard cliente** → producto **Betangar**.
2. Pon el mismo `ref_id` que usaste en `BTG_CONFIG.licencia_ref` y el **dominio** del cliente.
3. Define plan/precio/cortesía. Cobra y renueva desde ahí; si no paga, lo suspendes y su
   app muestra "Acceso suspendido" (el kill-switch lee la licencia CENTRAL por dominio o ref).

## Notas
- Aislamiento REAL: la base del cliente es independiente; imposible ver datos de otro.
- Control central: una sola tabla `licencias` y un solo panel cobran/suspenden a TODOS.
- Costo: Supabase free alcanza para empresas chicas; Pro (~$25/mes) si crecen — lo cubre la licencia.
- Si algún día prefieres multi-tenant compartido, se migra (añadir tenant_id + Auth + RLS); hoy no hace falta.
