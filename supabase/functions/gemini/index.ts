import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// BETANGAR — GEMINI, DEL LADO DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════════
// 🔴 POR QUÉ EXISTE: el análisis de combustible llamaba a Gemini DESDE EL
// NAVEGADOR, y para eso tenía que leer `configuracion.gemini_api_key`. O sea que
// la llave se le entregaba a TODO el que entrara a Betangar — choferes
// incluidos—, y de ahí se copia en dos clics. Una llave que baja al teléfono de
// alguien ya no es una llave.
//
// Ahora la llave no sale de la base: la lee ESTA función con la llave de
// servicio, llama a Gemini, y al navegador solo le vuelve el texto.
//
// ⚠️ La llave SIGUE configurándose desde la pantalla de Configuración: escribir
// `gemini_api_key` ya estaba restringido a superadmin/auditor/admin por
// `cfg_upd` + `cfg_clave_sensible`. Lo que cambia es que **ya no se puede leer**
// (ver la migración que ajusta `cfg_sel`). Se configura y no se recupera, que es
// como debe tratarse un secreto.
//
// Dos cosas que se responden acá y no en el navegador:
//   POST {prompt}   → el análisis
//   POST {estado:1} → solo si HAY llave o no, para pintar el ✓ en Configuración
//                     sin devolverla nunca.
// ═══════════════════════════════════════════════════════════════════════════════

// ⚠️ EL MODELO SE CLAVA, y este es el que hay (medido el 18/08/2026):
//    `gemini-2.0-flash`, que estaba acá, **YA NO EXISTE** — la API responde 404
//    «no longer available». O sea que el botón «Analizar con Gemini» estaba
//    muerto, y no se notaba porque además faltaba la llave: el error que se veía
//    era «No hay API key configurada», que mandaba a mirar el lugar equivocado.
//    Se probaron los vivos: `2.5-flash` tarda ~26 s · `3.6-flash` es errático.
//    ⛔ No se usa `gemini-flash-latest`: un alias móvil cambia de modelo sin
//    avisar y un día el análisis empieza a leerse distinto sin que nadie toque
//    nada. Ver la nota de `gemini-llave-donde-vive` en la memoria.
//    ⚠️ Acá se usa el `flash` y no el `flash-lite` del servicio técnico a
//    propósito: esto no corre contra un plazo de WhatsApp, y el análisis de 12
//    camiones mejora con un modelo que razone más.
const MODELO = "gemini-3.5-flash";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Quién puede pedirle un análisis a Gemini. Es una consulta que CUESTA dinero:
// no la dispara cualquiera que tenga sesión.
// ⚠️ `auditor` → `revisor` (2026-08-11): el rol se renombró. El `auditor` de hoy es la auditora
// externa, de SOLO LECTURA, y no dispara consultas que se facturan.
const ROLES = ["superadmin", "revisor", "admin", "directivo"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Solo POST." }, 405);

  // ── 1. QUIÉN PIDE ─────────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return responder({ error: "Hay que entrar primero." }, 401);

  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  if (!uRes.ok) return responder({ error: "Tu sesión venció. Entra otra vez." }, 401);
  const user = await uRes.json();

  // ⛔ El rol sale de `app_metadata`, que solo escribe el servidor. Si saliera de
  // `user_metadata`, cualquiera se asciende desde la consola del navegador.
  const rol = user?.app_metadata?.rol || "ninguno";
  if (!ROLES.includes(rol)) {
    return responder({ error: "Esto lo consulta administración." }, 403);
  }

  // ── 2. LA LLAVE, QUE NO SALE DE ACÁ ───────────────────────────────────────
  const kRes = await fetch(
    `${SUPABASE_URL}/rest/v1/configuracion?clave=eq.gemini_api_key&select=valor`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const kRows = kRes.ok ? await kRes.json() : [];
  const key = (kRows?.[0]?.valor || "").trim();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  // Solo dice SI hay llave. Nunca cuál.
  if (body.estado) return responder({ configurada: !!key });

  if (!key) {
    return responder({
      error: "No hay API key de Gemini configurada. Ve a Configuración → ⛽ Combustible.",
    }, 400);
  }

  const prompt = String(body.prompt || "").trim();
  if (!prompt) return responder({ error: "Sin pregunta no hay respuesta." }, 400);
  // Un prompt gigante es una factura gigante. Se corta acá, no en el navegador.
  if (prompt.length > 60000) return responder({ error: "La consulta es demasiado larga." }, 400);

  // ── 3. GEMINI ─────────────────────────────────────────────────────────────
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=` +
        encodeURIComponent(key),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // ⚠️ El análisis de combustible pide tres bloques (anomalías,
          // tendencias, recomendaciones): con el tope por omisión se corta a la
          // mitad. Y el tope incluye los tokens de PENSAMIENTO del modelo.
          generationConfig: { maxOutputTokens: 8000 },
        }),
        // ⏱ Toda llamada externa con plazo. Sin esto, una demora del proveedor
        // deja la pantalla girando hasta que el navegador se aburre.
        // ⚠️ 45 s medidos, no elegidos a ojo: el reporte de los 12 camiones tardó
        //    17,6 s con este modelo. Un período más largo tarda más, así que el
        //    plazo lleva margen. (Dato al pasar: `flash-lite` tardó 30 s con este
        //    mismo prompt — con textos grandes el liviano NO es el rápido.)
        signal: AbortSignal.timeout(45000),
      },
    );
    const data = await r.json();
    if (!r.ok) {
      // ⛔ El error de Google puede traer la llave en la URL del mensaje. Nunca
      // se reenvía tal cual al navegador.
      const msg = String(data?.error?.message || r.status).replace(/key=[^&\s]+/gi, "key=***");
      return responder({ error: "Gemini respondió: " + msg }, 502);
    }
    // ⛔ UN 200 NO ES UNA RESPUESTA COMPLETA. Si el modelo se quedó sin tokens el
    //    texto viene CORTADO A LA MITAD y el HTTP igual es 200. Un análisis de
    //    combustible truncado es peor que ninguno: se lee como si estuviera
    //    entero y se decide sobre la mitad. Se avisa en vez de mostrarlo.
    const cand = data?.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== "STOP") {
      return responder({
        error: "El análisis salió incompleto (" + cand.finishReason +
          "). Genera el reporte de un período más corto y vuelve a intentar.",
      }, 502);
    }
    const texto = cand?.content?.parts?.[0]?.text || "(sin respuesta)";
    return responder({ texto });
  } catch (e) {
    return responder({ error: "No se pudo conectar con Gemini: " + (e as Error).message }, 502);
  }
});
