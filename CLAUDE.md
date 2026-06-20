# CLAUDE.md — Betangar ERP (reglas críticas)

> Guía corta que se carga en cada sesión. Para el detalle completo (módulos, datos,
> edge functions, flujos) lee **`ARQUITECTURA.md`** en este repo.

## Proyecto
ERP de **Inversiones Betangar C.A.** (aseo urbano, 12 camiones JAC-B001…B012, factura viajes a la Alcaldía).
- `app.html` = app principal (oficina, ~12.5k líneas). `chofer.html` = PWA del chofer (QR por camión). `index.html` = landing pública.
- Supabase proyecto **`hrkjddehqnzcqwlkklqm`**. Producción **betangar.com** (GitHub Pages, rama `main`, push = deploy).
- ⚠️ El **mismo Supabase aloja Geppetto** (tablas `edu_*` / `usdt_*`): **NO TOCARLAS**.

## NORMA PERMANENTE (antes de cualquier cambio)
1. Confirmar que estás en `~/Betangar`.
2. Auditoría PRE: leer el código actual completo antes de tocar.
3. Entender por qué falla antes de corregir.
4. Implementar el fix.
5. Auditoría POST: verificar que lo demás sigue funcionando.
6. **Todo persiste en Supabase** — nada vive solo en memoria/localStorage (localStorage = caché).
7. `node --check` del JS inline antes de commit (extraer `<script>` y chequear).
8. Commit descriptivo + push a `main` solo cuando esté verificado.
9. **NO tocar módulos que ya funcionan.**

## Reglas de datos (NO romper)
- **PLANILLAS (`REGS`) = verdad operativa** para nómina, alcaldía, combustible y todo cálculo real (1 fila por `cam`+`f`, `t`=viajes).
- **viajes_chofer + checklist = SOLO vista en tiempo real / estimación** (widget flota del dashboard). No alimentan nada operativo.
- Fechas en BD = `YYYY-MM-DD`; `cam` = `JAC-B0XX`; UI muestra dd/mm/aa; semanas **lunes–sábado**.

## Gotchas que ya causaron bugs (verificar siempre)
- **Misma anon key** en `app.html` y `chofer.html` (la válida termina en `...RnG_ko`). Si "guarda pero no aparece en BD", probar la key con `curl` REST (401 = revocada).
- **`upsert({onConflict:'X'})`** exige índice/constraint **UNIQUE en X**, y los **nombres de columna deben coincidir** con el esquema (`information_schema.columns`). Si no, el write falla.
- **Tabla nueva con RLS** → crear policy `anon USING(true) WITH CHECK(true)` o el módulo falla en silencio (insert 401, read `[]`).
- **Nunca `.catch()` vacío** en writes: logear `res.error`.
- **WhatsApp desde el cliente** = `new Image().src='https://api.callmebot.com/...'` (NO `fetch`, por CORS). Gemini sí usa `fetch`.
- **Odómetro nunca baja** (`guardarKm` confirma si baja; checklist mecánico usa `Math.max`). KM del día = checklist `km_entrada − km_salida`, no `km_data`.
- **No hardcodear tasas**: usar `TASAS` (BCV) o modal manual.

## Patrón de persistencia
```
if(DB_READY&&supabase){ var res=await supabase.from('t').insert([row]).select();
  if(res.error){ mostrarToast('No se pudo guardar: '+res.error.message,'error'); } else ok=true; }
if(!ok) guardarEnCola('t',row);   // cola offline genérica
audit(...); mostrarToast(...);
```
