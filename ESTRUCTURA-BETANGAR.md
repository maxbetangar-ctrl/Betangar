# ESTRUCTURA DE BETANGAR — backup del mapa de la arquitectura

> Snapshot completo de la estructura del software (2026-06-28). Sirve de respaldo/documentación del
> "mapa" del sistema. Detalle de reglas en `CLAUDE.md` y `ARQUITECTURA.md`.

## 1. Qué es
ERP de **Inversiones Betangar C.A.** (aseo urbano, flota de 12 camiones JAC-B001…B012 que factura viajes
a la Alcaldía de Maracaibo / IMAU). Cubre: planillas de viajes, nómina, banca (BNC), combustible, flota,
mantenimiento, contabilidad, contratos, conciliación bancaria.

## 2. Archivos (repo `Betangar`, GitHub Pages = betangar.com, rama main → push = deploy)
- **app.html** (~2.6k líneas) — UI principal de oficina (todas las pantallas, una sola página con tabs).
- **app.js** (~13.5k líneas) — TODA la lógica. Se carga con `<script src="app.js?v=FECHA">` (bumpear el `?v=` al editar).
- **money.js** (~35 líneas) — matemática de dinero PURA y testeable (RET_DEFAULT, perfilRetencion, calcRetenciones). Se carga ANTES de app.js.
- **chofer.html** + **chofer-sw.js** + **chofer-manifest.json** — PWA del chofer (QR por camión; sin login por decisión de Máximo). Carga viajes/checklist/combustible/km.
- **index.html** — landing pública.
- **test/** (`test.js` + `harness.js`) — pruebas (53; `npm test` corre node --check + las pruebas). CI en **.github/workflows/test.yml** (corre en cada push).
- **migrations/** — SQL (ver §6). **package.json** — scripts QA. **CLAUDE.md** / **ARQUITECTURA.md** / **CLONAR_EMPRESA.md** / **ISO_DIAGNOSTICO_BETANGAR.md** / **INSTRUCCIONES_RRHH_IMAU.md** — docs.
- Externo (no en repo): **C:\Users\Maxbetangar\backups-supabase\** (respaldo de la base) + **AUDITORIA-BETANGAR-VENTA.md** + **SEGURIDAD-BETANGAR-DIAGNOSTICO.md** (fuera del repo público a propósito).

## 3. Datos / backend
- **Supabase** proyecto `hrkjddehqnzcqwlkklqm` (la MISMA base aloja Geppetto/Ranita con tablas `edu_*` — NO tocarlas). Plan FREE (sin backups auto → respaldo manual + pasar a Pro al vender).
- **Edge functions:** `bnc-saldo` (saldo/movimientos BNC, producción ACTIVA), `bnc-webhook` (notificaciones de pago + WhatsApp).
- **RPCs (plpgsql):** `avanzar_nomina` (nómina+cuotas atómico, SECURITY DEFINER), `app_rol` (rol del usuario desde btg_usuarios para RLS), `licencia_estado`/`licencia_por_dominio` (kill-switch SaaS), `bnc_actualizar_config`.
- **API de usuarios:** `preescolargeppetto.com/api/btg-usuarios` (Next.js, service_role) — crea/gestiona usuarios Auth + btg_usuarios. ⚠️ al clonar apunta a esto, cambiar por cliente.

## 4. Módulos / tabs (control por rol en `PERMISOS`, app.js ~248)
dashboard · banco-bnc · conciliacion · checklist · mensajes-wa · planilla · historico · reporte · abonos ·
banco · proveedores · financiero · nomina · asistencia · combustible · control-combustible · km ·
documentos · inventario · llantas · metas · empleados · prestamos · multas · stats · ranking · rentabilidad ·
contratos · usuarios · auditoria · salud · config · galeria · porteria · mecanico · operativo · cxp · cajachica.

**Roles:** superadmin, admin, operador, rrhh, visualizador, directivo, (demos), + operativos: vigilante, mecanico, asistencia, operativo. Los roles son perm-aware en UI **y ahora en BD** (RLS por rol, §7).

## 5. Tablas principales (Betangar)
**Operación:** planillas (verdad operativa: 1 fila por cam+fecha, t=viajes, m=monto), viajes_chofer/checklist/flota_estado/km_data/rutas_estado (vista en vivo del chofer), porteria (entradas/asistencia).
**Dinero:** abonos (cobros), pagos_alcaldia, pagos_nomina, pagos_bnc, bnc_movimientos, bnc_notificaciones, bnc_config(+_estado), nomina_historial, cxp, proveedores, gastos_variables, caja_chica(+_reposiciones), tasas_diarias, contratos(+retenciones JSON).
**RRHH:** empleados (PII), prestamos, multas, asistencia, anomalias_rrhh, documentos_emp.
**Flota/mant:** combustible_* (mediciones/tanques/vehiculos/alertas), gasoil, mantenimientos, engrases, lavados, llantas, documentos_cam, inventario, imau_fijos.
**Sistema:** btg_usuarios (Auth+rol), auditoria (append-only), tokens_pendientes (aprobaciones), health_check, metas. Multi-contrato: tipos_unidad/unidades/operaciones.

## 6. Migraciones (migrations/)
- migrations_btg_usuarios.sql (Auth), migrations_rls_authenticated.sql (RLS base), _2c_revoke_anon (cierra anon en sensibles), _2d_tokens / _2d_bis (tokens), add_bnc_movimientos, add_pagos_nomina_bnc, add_retenciones_contrato (CxP/retención por contrato), **add_auditoria_append_only**, **add_rpc_avanzar_nomina** (nómina atómica), **add_rls_por_rol** (segregación por rol). Todas CORRIDAS.

## 7. Estado de seguridad (vendible)
- anon NO lee/escribe/borra nada (verificado en vivo). Login Supabase Auth + btg_usuarios.
- **2FA TOTP**: obligatorio para superadmin/admin/rrhh; opcional resto; "confiar en equipo 30 días"; reset por admin.
- **RLS por rol** (`app_rol()` + política `btg_rol_oficina`): operativos no leen sueldos/PII/dinero; oficina sí. Fail-open en rol null (no tranca).
- Token de aprobación **server-authoritative** (aprobado=true). Auditoría **append-only**. Tokens con crypto.
- Marca/instancia configurable en **BTG_CONFIG** (app.js ~12): empresa_*, data_url/key, lic_*, licencia_ref, auth_correo_obligatorio, sentry_key. Kill-switch de licencia. Sentry (errores) etiquetado por empresa.

## 8. Reglas de dinero clave
- USD congelado a la tasa BCV del día al pagar (`getTasaFecha`, tabla tasas_diarias).
- Nómina: chofer $10 / ayudante $5 / IMAU $2.5 por viaje, recargo domingo, descuentos préstamos/multas, patio. Motor único `calcNom`; guardado atómico vía RPC avanzar_nomina.
- Alcaldía: base=viajes×tarifa; retenciones (IVA/ISLR/Mun/timbre/fiel 10%/laboral) + Resp. Social 3% egreso; paga en 2 partes (neto + fiel). Retenciones configurables por contrato.
- **Utilidad Real = Cobrado − TODOS los gastos** (`_totalEgresos`: nómina+gasoil+7.5%+fijos+variables+CxP todas+multas empresa). Dashboard y Financiero usan la misma fórmula.
- Combustible: compra a precio real editable; surtida al costo promedio del tanque (FIFO).
- Persistencia: helper `guardar()` (chequea error + encola); cola offline con dead-letter + reintento upsert; nada de "✅" si no guardó.

## 9. Deploy
Editar → `node --check`/`npm test` → bumpear `app.js?v=` en app.html → commit → push a main (GitHub Pages despliega ~1-2 min). Migraciones: correr en Supabase SQL Editor (idealmente antes del código que las usa). Versión actual: v=20260628y.
