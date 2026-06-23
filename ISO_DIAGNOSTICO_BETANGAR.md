# Diagnóstico ISO — Inversiones Betangar C.A. (app.html)

> Gap analysis del ERP Betangar contra las normas que aplican. Estado **2026-06-23**.
> Base: revisión del código (`app.html`, 14.367 líneas) + pruebas reales contra Supabase
> (`hrkjddehqnzcqwlkklqm`) con la anon key pública y con sesión autenticada.
> Semáforo: 🟢 conforme · 🟡 parcial · 🔴 brecha · ⚪ no evaluable desde aquí.

## 1. Alcance y normas
- **ISO/IEC 25010** — calidad del producto de software.
- **ISO/IEC 27001** — seguridad de la información (controles Anexo A).
- **ISO 55000** — gestión de activos (la flota de 12 camiones JAC-B0XX).
- **IEEE 730** — plan de aseguramiento de calidad del software (SQA).

## 2. Resumen ejecutivo
| Norma | Estado | Riesgo dominante |
|---|---|---|
| 27001 — Seguridad | 🟡 | Tablas sensibles ya cerradas a anon (Fase 2c + 0.1). Residuales: `audit()` no persiste, respaldos sin política, `tasas_diarias` abierta, vistas SECURITY DEFINER |
| 25010 — Calidad | 🟡 | Mantenibilidad: monolito de 14.367 líneas sin módulos ni pruebas |
| 55000 — Activos | 🟡 | Mantenimiento sin plan preventivo formal ni KPIs de disponibilidad/ciclo de vida |
| IEEE 730 — SQA | 🔴 | No existe plan de calidad documentado (este documento lo inicia) |

**Prioridad ahora:** ya no es la RLS de las sensibles (resuelta). El mayor riesgo restante es **mantenibilidad (25010)** — el monolito — y los residuales de 27001 (auditoría persistente + respaldos).

## 3. ISO/IEC 27001 — Seguridad de la información
La **anon key** (`...RnG_ko`) está embebida en `app.html`/`chofer.html` (público por diseño de
Supabase). Por eso **todo permiso del rol `anon` equivale a permiso para cualquiera en internet.**

### 3.1 Evidencia real (pruebas REST 2026-06-23)
| Tabla | anon SELECT | anon DELETE | Veredicto |
|---|---|---|---|
| `btg_usuarios` | ~~lee + borra~~ | 🟢 cerrado | ✅ Fase 0.1 (2026-06-23) — `revoke all from anon` |
| `auditoria` | ~~borra~~ | 🟢 cerrado | ✅ Fase 0.1 (2026-06-23) |
| `nomina_historial` | ~~lee + borra~~ | 🟢 cerrado | ✅ Fase 0.1 (2026-06-23) |
| `planillas` | ❌ | ❌ (401) | 🟢 seguro (Fase 2c, 2026-06-21) |
| `abonos` | ❌ | ❌ (401) | 🟢 seguro (Fase 2c) |
| `gasoil` | ❌ | ❌ (401) | 🟢 seguro (Fase 2c) |
| `configuracion` | ❌ | ❌ (401) | 🟢 seguro (Fase 2c) |
| `empleados`/`cxp`/`caja_chica`/`proveedores`/`prestamos`/`multas` | ❌ | ❌ | 🟢 seguro (Fase 2c) |
| `tasas_diarias` | ✅ lee | ✅ borra (204) | 🟡 **abierta** — tabla nueva (2026-06-23); cerrar escritura anónima |
| `combustible_mediciones` | ✅ lee | ✅ borra (204) | ⚪ tabla del CHOFER (Grupo B) — anon a propósito (chofer.html sin login, decisión de Máximo) |
| Grupo B chofer (`checklist`,`flota_estado`,`km_data`,`porteria`,`viajes_chofer`) | ✅/✅ | abierto | ⚪ intencional hasta que se haga login del chofer |

> **Corrección (2026-06-23):** la primera sonda usó la columna `id` (que varias tablas no tienen) → daba HTTP 400 (error de columna) que se interpretó por error como "borrado abierto". Con columnas válidas, las tablas sensibles ya estaban cerradas desde la **Fase 2c**. Las únicas brechas reales eran `btg_usuarios` y `nomina_historial` (cerradas en Fase 0.1) y `tasas_diarias` (pendiente).

### 3.2 Controles Anexo A
- **A.9 Control de acceso**: 🟡 Login por Supabase Auth (`btg_usuarios`, email sintético) + roles
  en la app. PERO la BD no respalda los roles: las políticas RLS no exigen autenticación para
  escribir en varias tablas. El control de acceso es solo de UI, no de datos.
- **A.12.4 Registro y monitoreo**: 🟡 Existe `audit()` → tabla `auditoria`, pero anon puede
  borrarla ⇒ no es prueba forense. Falta inmutabilidad (append-only, sin DELETE/UPDATE).
- **A.10 Criptografía**: 🟢/🟡 HTTPS + Supabase Auth (hash bcrypt). BNC usa AES. **Verificar**
  que la `service_role` key NUNCA esté en el cliente (no encontrada en app.html — confirmar).
- **A.12.3 Respaldos**: ⚪ No evaluable desde el código (PITR es config del panel Supabase).
  Falta política de respaldo documentada y prueba de restauración.
- **A.8 Clasificación de la información**: 🔴 No hay clasificación formal (datos personales de
  empleados, cédulas, cuentas bancarias, nómina → requieren tratamiento de "confidencial").

## 4. ISO/IEC 25010 — Calidad del producto
| Característica | Estado | Notas |
|---|---|---|
| Adecuación funcional | 🟢 | Cubre nómina, banca BNC, flota, combustible, contabilidad, contratos |
| Eficiencia de desempeño | 🟡 | Carga en paralelo (`Promise.allSettled`); pero HTML único de ~3,5 MB se parsea entero, sin lazy-load |
| Compatibilidad | 🟢 | Web + PWA chofer; mismo Supabase |
| Usabilidad | 🟡 | Funcional; sin accesibilidad formal (WCAG), usa `prompt()`/`alert()` nativos |
| **Fiabilidad** | 🟡 | Cola offline + fallback localStorage + reintentos; **sin pruebas automatizadas** |
| **Seguridad** | 🔴 | Ver §3 (RLS) |
| **Mantenibilidad** | 🔴 | **14.367 líneas en un solo `app.html`**, lógica de negocio mezclada con UI, sin módulos ni tests → alto riesgo de regresión |
| Portabilidad | 🟢 | Estático (GitHub Pages) + Supabase |

## 5. ISO 55000 — Gestión de activos (la flota)
| Aspecto | Estado | Notas |
|---|---|---|
| Inventario de activos | 🟢 | 12 camiones (`FLOTA`) + config vehículos combustible |
| Mantenimiento | 🟡 | KM/service/lavado/engrase/llantas + alertas de service; falta **plan preventivo formal** y registro documentado |
| Desempeño del activo | 🟡 | Rentabilidad por camión existe; faltan KPIs de **disponibilidad / MTBF / confiabilidad** |
| Ciclo de vida | 🔴 | No hay gestión adquisición→baja, depreciación, ni política de reemplazo |
| Gestión de riesgo del activo | 🔴 | No formalizada |

## 6. IEEE 730 — Plan de aseguramiento de calidad (SQA)
🔴 No existe un SQA plan. Elementos presentes de forma informal: control de versiones (git),
chequeo de sintaxis (`node --check` pre-commit), revisión PRE/POST por norma interna. Faltan:
proceso de pruebas documentado, gestión de configuración, métricas de calidad, criterios de
aceptación, roles y responsabilidades de QA.

## 7. Roadmap priorizado (impacto / esfuerzo / riesgo)
**FASE 0 — Seguridad RLS (crítico, alto impacto).** Cerrar por capas, verificando antes que la
app escriba con el JWT del usuario (no con la anon key):
- 0.1 ✅ **HECHO (2026-06-23)** — `btg_usuarios`, `auditoria`, `nomina_historial`: `revoke all from anon`. Verificado: anon 401, app (JWT) 200.
- 0.2 ⏳ `planillas`, `abonos`, `gasoil`, `configuracion`, `combustible_mediciones`, `tasas_diarias`: cortar escritura/borrado anónimo.
  - **Bloqueante**: `_tokRestHdr()` usa la anon key (no el JWT). Hay que migrarlo al token de sesión ANTES de cerrar estas tablas, o se rompe el borrado por token / abonos.
- 0.3 Auditoría real: `audit()` hoy solo guarda en memoria → persistir a `auditoria` (con el JWT) y hacerla append-only (sin DELETE/UPDATE ni para authenticated).

**FASE 1 — Mantenibilidad 25010 (medio plazo).** Extraer el JS a archivos/módulos por dominio,
introducir pruebas mínimas (smoke + reglas críticas de nómina/tasas), mantener `node --check`.

**FASE 2 — 27001 complementario.** Política de respaldos + prueba de restauración; auditoría
inmutable; clasificación de datos (confidencial: empleados, banca, nómina).

**FASE 3 — 55000 flota.** Plan de mantenimiento preventivo formal + KPIs de disponibilidad/MTBF
+ ciclo de vida y reemplazo del activo.

**FASE 4 — IEEE 730.** Formalizar este documento como SQA plan vivo (versionado, con métricas).

## 8. Próximo paso sugerido
Ejecutar **Fase 0.1** (cerrar `btg_usuarios` + `auditoria` + `nomina_historial` al rol anónimo),
previa verificación de que la app lee esas tablas ya autenticada. Es el mayor riesgo con el
menor esfuerzo y bajo impacto en la operación.
