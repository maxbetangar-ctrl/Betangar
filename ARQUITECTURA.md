# BETANGAR ERP — Arquitectura y Guía Completa

> Documento de traspaso para retomar el proyecto en un chat nuevo. Resume qué es el
> software, sus módulos, cómo se comunican, la base de datos y las reglas críticas.
> Última actualización: 2026-06-19.

---

## 1. Qué es

ERP de **Inversiones Betangar C.A.** — empresa de **aseo urbano** con flota de **12 camiones JAC** (JAC-B001…B012) que facturan viajes a la **Alcaldía**. Cubre: registro diario de viajes (planillas), cobros/abonos, banco (BNC), proveedores/CxP, financiero, nómina, asistencia, portería, mecánico/checklist, operativo (rutas), combustible, KM/servicio, documentos, inventario, llantas, metas, multas, préstamos, empleados, contratos, estadísticas, caja chica.

## 2. Stack y despliegue

- **Frontend:** HTML+JS vanilla, un solo archivo gigante por app. Sin build, sin framework.
- **Backend:** Supabase (Postgres + PostgREST + Edge Functions). Proyecto **`hrkjddehqnzcqwlkklqm`** → `https://hrkjddehqnzcqwlkklqm.supabase.co`.
- **Hosting:** GitHub Pages, repo `maxbetangar-ctrl/Betangar`, rama **`main`**, dominio **betangar.com** (archivo `CNAME`). Push a main = deploy.
- **Librerías CDN:** supabase-js v2, xlsx (importar Excel de planillas), emailjs (correos/reportes).
- **WhatsApp:** CallMeBot vía `new Image().src=...` (NO fetch, por CORS) desde el cliente; y desde Edge Functions (server) para envíos garantizados.

### Archivos
| Archivo | Qué es |
|---|---|
| `app.html` | **La app principal** (~12.5k líneas). Todo el ERP de oficina. |
| `chofer.html` | PWA para choferes: marcar viajes + checklist + medición CM del tanque. Se abre por QR `betangar.com/chofer.html?cam=JAC-B0XX`. |
| `chofer-sw.js` | Service worker del chofer (offline-first, **network-first**). Subir `CACHE_NAME` (vX) fuerza actualización en los teléfonos. |
| `chofer-manifest.json` | Manifest PWA del chofer. |
| `index.html` | Landing corporativa pública (sin login ni Supabase, links a app.html). |
| `logo.png` | Logo. |

## 3. Autenticación, claves y RLS

- **No hay Supabase Auth.** El login es propio: usuarios en tabla `usuarios_app`, sesión en `SESION` (objeto JS) + localStorage. Roles definidos en el objeto `USUARIOS`/`PERMISOS`.
- **Anon key:** el cliente usa la **anon key** (pública por diseño). ⚠️ **REGLA CRÍTICA: `app.html` y `chofer.html` DEBEN usar la MISMA anon key válida.** La válida termina en `...RnG_ko` (iat 1777659572). *(Bug histórico: chofer.html tenía una key vieja revocada → 401 → los viajes no subían. Si algo "se guarda pero no aparece en BD", probar la key con `curl` REST: 401 = revocada.)*
- **RLS:** todas las tablas tienen RLS **activo** con política **permisiva** `FOR ALL TO anon USING(true) WITH CHECK(true)` (nombre típico `betangar_access` o `anon_all_*`). Es decir, el modelo actual es **anon puede todo**. Endurecer RLS es un proyecto aparte pendiente (ver memoria `betangar-seguridad-diagnostico`).
  - ⚠️ Si creas una tabla nueva con RLS y **olvidas la policy**, el anon recibe 401 al insertar y `[]` al leer → el módulo "falla en silencio". *(Pasó con `caja_chica`.)*

## 4. Capa de datos (cómo carga y dónde vive cada cosa)

### Roles de carga
- `cargarDatosPorRol()` decide: roles limitados (vigilante/mecanico/operativo/asistencia) → `cargarDatosMinimos()` (solo lo necesario); el resto (superadmin/admin/operador/rrhh) → `cargarDatosDB()` (carga completa).

### `cargarDatosDB()` — carga a arrays globales en memoria (fuente de verdad = Supabase)
Tablas → globals: `planillas→REGS`, `abonos→ABONOS`, `empleados→EMPLEADOS`, `gasoil→GASOIL`, `cxp→CXP`, `proveedores→PROVEEDORES`, `prestamos→PRESTAMOS`, `multas→MULTAS`, `inventario→INVENTARIO`, `contratos→CONTRATOS`, `gastos_variables→GASTOS_VARIABLES`, `pagos_alcaldia→PAGOS_ALC`, `km_data→KM_DATA`, `auditoria→AUDITORIA_LOG`, y varias claves de `configuracion` (`general→cfg`, `whatsapp→WA`, `asistencia_data→ASISTENCIA`, `docs_cam/docs_emp/metas_data`, `tanque_nivel`). Luego dispara: `cargarCfgCorrelativo`, `cargarDatosCompartidos`, `cargarAnomaliasDecisiones`, `cargarCombustibleData`, `cargarCxP`, `cargarCargos`.

### Capa compartida (cruza módulos)
- `cargarDatosCompartidos()` → `VIAJES_CHOFER` (tabla viajes_chofer) y `CHECKLIST_DATA` (tabla checklist). Más `GASOIL` y `KM_DATA` que ya existen.
- Helpers de cruce reutilizables: `viajesMapaFecha/viajesPorCamFecha` (chofer), `checklistDeFecha/CamFecha`, `kmRecorridoCamFecha` (= checklist km_entrada−km_salida), `camTieneChecklistHoy`, y los **operativos** `viajesPlanillaMapaFecha/CamFecha/CamRango` + `ultimaFechaPlanilla` (leen REGS).

### ⭐ REGLA DE FUENTES DE DATOS (definida por Máximo)
- **PLANILLAS (`REGS`) = verdad operativa** para nómina, alcaldía, **combustible** y cualquier cálculo real. 1 fila por `cam`+`f` con `t`=viajes. `planilla.km` viene en 0 (no se usa).
- **viajes_chofer + checklist (chofer) = SOLO vista en tiempo real / estimación** para ver el día sin esperar la auditoría de planillas. Alimenta el widget de flota del dashboard. NO alimenta nada operativo.

### Patrón de persistencia (SIEMPRE)
```
if(DB_READY&&supabase){ var res=await supabase.from('tabla').insert([row]).select();
  if(res.error){ mostrarToast('No se pudo guardar: '+res.error.message,'error'); }
  else { ok=true; } }
if(!ok) guardarEnCola('tabla',row);   // cola offline genérica (localStorage) que reintenta
audit(...); mostrarToast(...);
```
- `localStorage` = **solo caché**, nunca fuente de verdad.
- Cola offline: `COLA_OFFLINE` + `procesarColaOffline()` (reintenta cada 60s; descarta tras 3 fallos de red, o ante error del servidor).
- ⚠️ **Para `upsert({onConflict:'X'})` DEBE existir un índice/constraint UNIQUE en X**, y los nombres de columnas deben coincidir con el esquema, o el write falla (a veces silenciado por `.catch()` vacío).

## 5. Navegación, roles y permisos

- Menú lateral con `onclick="sp('id')"`. `sp(id)` valida `PERMISOS[rol]`, muestra `#p-<id>` y llama al render del módulo.
- `PERMISOS` = objeto rol→[ids permitidos]. `NAV_LABELS` = etiquetas. `aplicarPermisos()` oculta los `#mi-<id>` que el rol no tiene.
- Roles: `superadmin, admin, operador, rrhh, visualizador, directivo` (completos) + `asistencia, mecanico, operativo, vigilante` (una sola pantalla) + `demo_*`.

## 6. Módulos (qué consume / qué tabla / funciones clave)

| Módulo (id) | Tabla(s) | Render / claves |
|---|---|---|
| Dashboard (`dashboard`) | REGS, ABONOS, viajes_chofer, checklist, bnc | `renderDash`, `renderWidgetFlota` (viajes chofer hoy + desglose semanal Lun–Sáb), `cargarPanelChoferes` (En vivo vs Facturado), `renderDashFinanciero` (Facturado/Cobrado/Por Cobrar/Utilidad Real), `renderReporteKM` (recorridos desde checklist) |
| Registro Diario (`planilla`) | planillas | alta manual + import Excel (`onConflict:'p'`); produce REGS |
| Histórico (`historico`) | planillas | filtros por semana |
| **Cobranza / Alcaldía (`reporte`)** | planillas, abonos (`onConflict:'fact'`), pagos_alcaldia | **Módulo unificado de cobros** — 4 pestañas: Estado de Cuenta (FIFO + antigüedad/aging + KPIs + Recordatorio WA), Ejecución Semanal, **Pagos** (registrar abonos; antes el módulo "Abonos", fundido aquí), Precios. Motor único `calcCobranzaSemanas()` / `calcCobranzaAging()` (mismo cálculo en reporte y panel). `sp('abonos')` redirige a la pestaña Pagos; el menú "Abonos" se eliminó. |
| Banco BNC (`banco`) | bnc_notificaciones, bnc_config | saldo (edge `bnc-saldo`), movimientos |
| Conciliación (`conciliacion`) | bnc_notificaciones, abonos | cruza pagos BNC ↔ abonos |
| Proveedores/CxP (`proveedores`,`cxp`) | proveedores, cxp | retenciones SENIAT, pagos |
| Financiero (`financiero`) | REGS, ABONOS, GASOIL, CXP, gastos | dashboard financiero, gastos fijos |
| Caja Chica (`cajachica`) | caja_chica, caja_chica_reposiciones | `renderCajaChica` |
| Nómina (`nomina`) | REGS, EMPLEADOS, PRESTAMOS, MULTAS, ASISTENCIA, anomalias_rrhh | `calcNom` (choferes por viajes del camión; ayudantes casados por nombre ay1/ay2) + **cotejo anomalías RRHH** |
| Asistencia (`asistencia`) | configuracion.asistencia_data (`ASISTENCIA`) + porteria biométrico | matriz P/A/J por empleado/semana/día |
| Portería (`porteria`) | porteria | entradas/salidas/asistencia biométrica |
| Mecánico (`mecanico`) | checklist (`onConflict:'fecha,cam'`), km_data, flota_estado | checklist taller; cambia estado del camión |
| Check List (`checklist`) | checklist | flujo de checklist |
| Operativo (`operativo`) | rutas_estado (`onConflict:'fecha,parroquia'`) | rutas por parroquia |
| **Combustible (`combustible`)** [viejo] | gasoil, configuracion.tanque_nivel | tanque interno 4600L, compra Tumaca/Boscán, despacho a camión, gasolina personal |
| **Control Combustible (`control-combustible`)** [nuevo] | combustible_tanques_config, combustible_vehiculos_config, combustible_mediciones, combustible_alertas + lee gasoil/REGS/checklist | cubicación cm→L, alertas, reporte mensual con Gemini |
| Km/Servicio (`km`) | km_data (`onConflict:'cam'`), mantenimientos, lavados, engrases | odómetro, mantenimientos, lavado(45d)/engrase(15d) |
| Documentos (`documentos`) | configuracion.docs_cam/docs_emp | vencimientos |
| Inventario (`inventario`) | inventario, inventario_mov | stock |
| Llantas (`llantas`) | configuracion (LLANTAS) | por posición |
| Metas (`metas`) | configuracion.metas_data | metas semanales |
| Empleados (`empleados`) | empleados | RRHH, cumpleaños, datos bancarios, carnets |
| Préstamos (`prestamos`) | prestamos | descuento en nómina |
| Multas (`multas`) | multas | descuento chofer/empresa |
| Estadísticas/Ranking (`stats`,`ranking`) | REGS | top choferes, etc. |
| **Rentabilidad x Camión (`rentabilidad`)** | REGS, GASOIL | Ingreso (planillas) − Combustible (gasoil despachos) − Nómina (chofer+ayudantes) por camión. Motor `calcRentabilidadCamiones(des,hta)`; KPIs + ranking + gráfico + imprimir. Ingreso reconcilia con facturado del dashboard. |
| Contratos (`contratos`) | contratos | |
| Usuarios (`usuarios`) | usuarios_app | gestión de acceso |
| Auditoría (`auditoria`) | auditoria | log de acciones |
| **Salud de Datos (`salud`)** | health_check + lee todas | **Anti-fallo-silencioso** (superadmin/admin). `renderSaludDatos()`: prueba de ESCRITURA real (heartbeat upsert a `health_check`) → detecta clave revocada/RLS/write roto; + lectura y frescura por tabla (conteo + última escritura + semáforo); + cola offline. Si "guarda en pantalla pero no en BD", aquí sale 🔴 al instante. |
| Config BNC (`banco-bnc`) | bnc_config | credenciales BNC |
| Configuración (`config`) | configuracion (varias claves) | tabs: General, Flota, WhatsApp, Recordatorios, Nómina Admin, Correlativo, Cargos, **⛽ Combustible** (vehículos/tanques/Gemini key) |
| Mensajes WA (`mensajes-wa`) | mensajes_wa | difusión |

### chofer.html (PWA)
- Produce: `viajes_chofer` (`onConflict:'fecha,cam,viaje_num'`), `checklist` (`onConflict:'fecha,cam'`), `combustible_mediciones` (CM tanque JAC).
- Guarda local primero (el chofer ve el viaje aunque no haya red) → sube a Supabase → si falla, cola offline (`btg_cola_chofer`) que sincroniza al reconectar (`sincronizarCola`).

## 7. Cómo se comunican los módulos (flujo de datos)

```
chofer.html ──viajes_chofer/checklist──► (vista en vivo) Dashboard widget flota
                                          └► Control Combustible (KM del día desde checklist)
oficina ──planillas(REGS)──► Nómina, Reporte Alcaldía, Financiero, Control Combustible (viajes reales)
                            └► Nómina × ASISTENCIA ──► anomalías RRHH (anomalias_rrhh)
gasoil ──► Combustible (viejo) y Control Combustible (litros recibidos/comprados)
km_data ──► Km/Servicio (odómetro) ; checklist ──► recorridos del día
BNC: bnc-webhook(edge) ──bnc_notificaciones──► Banco/Conciliación/Dashboard
```

## 8. Edge Functions y crons (server-side, usan service_role)

| Función | jwt | Rol |
|---|---|---|
| `bnc-webhook` (v9) | no | Recibe notificaciones de pago BNC → `bnc_notificaciones` + WhatsApp a socios/operativo. **El WA de pagos lo manda ESTA función, no la app.** |
| `bnc-webhook-dev` | no | Igual, ambiente dev (`bnc_notificaciones_dev`). |
| `bnc-saldo` (v6) | sí | Consulta saldo BNC (la app la llama con Bearer anon). |
| `bnc-api`, `bnc-pos-virtual` | no | Integración BNC (C2P/POS). |
| `alertas-diarias` (v5) | sí | **Cron**: resumen diario + checklist faltantes + service próximo (8am). |
| `recordatorios-cron`, `Recordatorios`, `cumpleanos`, `bright-responder` | varía | Recordatorios/cumpleaños vía WhatsApp. |
| `edu-pin-semanal` | no | (Geppetto, otro proyecto en el mismo Supabase). |

> Nota: el mismo proyecto Supabase aloja también **Geppetto** (tablas `edu_*`, `usdt_*`). **No tocar esas tablas/funciones** desde Betangar.

## 9. Reglas y "gotchas" críticas (LEER antes de tocar)

1. **Misma anon key** en app.html y chofer.html; si se rota en Supabase, actualizar ambas.
2. **PLANILLAS = verdad operativa; chofer = solo vistazo.** No mezclar.
3. **`onConflict` requiere UNIQUE** y **nombres de columna deben coincidir** con el esquema real (verificar con `information_schema.columns`). Evitar `.catch()` vacíos que ocultan errores: siempre logear `res.error`.
4. **RLS:** tabla nueva → crear policy `anon USING(true)` o el módulo falla en silencio.
5. **WhatsApp desde el cliente:** SIEMPRE `new Image().src=callmebot...`, nunca `fetch` (CORS). Gemini sí usa fetch (POST).
6. **Odómetro nunca baja:** `guardarKm` pide confirmación si el km nuevo < anterior; el checklist del mecánico usa `Math.max`. KM del día sale de checklist (km_entrada−km_salida), no de km_data.
7. **Fechas:** en BD todo `YYYY-MM-DD` (texto o date), `cam` = `JAC-B0XX`. En UI se muestra dd/mm/aa. Semanas operativas **lunes–sábado**.
8. **No hardcodear tasas:** usar `TASAS` (BCV) o modal manual.
9. **NO tocar módulos que ya funcionan** sin auditoría previa; `node --check` (extrayendo el JS inline) antes de commit; commit + push a main.
10. **Geppetto comparte el Supabase** — no tocar `edu_*`/`usdt_*`.

## 10. Bugs corregidos en la auditoría 2026-06-19 (precedentes)

1. **chofer.html anon key revocada** (401) → viajes/checklist no subían. Fix: igualar key + SW v3.
2. **caja_chica / caja_chica_reposiciones**: RLS sin policy → inserts 401. Fix: policy anon.
3. **mantenimientos**: insert con `fecha/descripcion/registrado_por` (esquema `f/desc_trabajo`) → no guardaba. Fix columnas.
4. **engrases**: insert con `fecha/registrado_por` (esquema `f/obs`) → no guardaba. Fix columnas.
5. **flota_estado**: upsert con `cam`+`onConflict:'cam'` (tabla usa `unidad`+UNIQUE(unidad)) → escritura muerta. Fix columnas/onConflict (el estado real vive en km_data).
6. **KM negativo / Utilidad "192 millones"**: el primero por odómetro invertido (blindado); el segundo era formato (eran $192 mil, cálculo correcto).

## 11. Pendientes / oportunidades

- Que los choferes adopten chofer.html (QR ya impreso por camión) para poblar la vista en vivo.
- Endurecer RLS (hoy todo es anon-permisivo) — proyecto aparte.
- `flota_estado` está prácticamente en desuso (el estado vive en `km_data`); evaluar si se elimina.
- ALERTA 3 de combustible (diferencia con proveedor) no implementada (requería capturar medidor en el módulo de compra viejo).
- Tablas con RLS sin policy que NO usa la app (solo edge): `alertas_log`, `bnc_notificaciones_dev` — OK así (service_role las escribe).

---
*Para detalles vivos del esquema: `information_schema.columns` y `pg_policies` en Supabase (proyecto hrkjddehqnzcqwlkklqm).*
