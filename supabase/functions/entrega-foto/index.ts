import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════
// LA FOTO DE LA ENTREGA, FIRMADA — para poder CERRAR el bucket `entregas`
//
// 🔴 POR QUÉ EXISTE (17/09/2026). Máximo: *«nada debe ser público, puede que en Betangar por
//    ahora, pero en el resto no puede ser público»*.
//
//    El bucket `entregas` es PÚBLICO en las cinco bases, y no por descuido: `recibir.html`
//    —la página que abre **el cliente final, sin cuenta**, con un token en la URL— mete
//    `foto_url` directo en un `<img src>`. Sin bucket público esa imagen no carga, y ahí no
//    hay ninguna sesión que pueda firmar nada. Medido el 17/09: **4.115 fotos públicas en
//    FLOTILLA**, 122 en Tony Gas, 13 en Betangar.
//
//    Esta función es la pieza que faltaba para poder cerrarlo: **el token ES la
//    autorización**. Quien tiene el enlace de la entrega ve SU foto; nadie más ve ninguna.
//
// ⛔ LAS TRES REGLAS QUE LO HACEN SEGURO
//  1. **LA RUTA NO VIAJA DESDE EL NAVEGADOR.** Lo único que se recibe es el token. La ruta
//     sale de la fila que ese token identifica. Si el cliente pudiera mandar la ruta, esto
//     sería un firmador de cualquier archivo del bucket para cualquiera.
//  2. **UN TOKEN QUE NO EXISTE NO DICE NADA.** Devuelve el mismo 404 que uno sin foto: nada
//     que sirva para tantear tokens.
//  3. **LA FIRMA LA HACE EL SERVICE ROLE, ACÁ ADENTRO.** La clave nunca sale de la función.
//
// ⚠️ TOLERA LAS DOS FORMAS DE LO GUARDADO, y esto no es opcional: hay 4.237 filas con la URL
//    pública COMPLETA guardada de antes. Si esto solo entendiera rutas, cerrar el bucket
//    dejaría sin foto a todas las entregas viejas. Se acepta la URL pública, la firmada y la
//    ruta pelada. [[norma-respaldo-que-inventa-un-dato]]
//
// ⚠️ NO SE PERSISTE LA URL FIRMADA EN NINGÚN LADO: vence. Se pide cada vez que alguien abre
//    la página, que es exactamente una vez por visita.
//
// Entrada:  POST { "token": "..." }
// Salida:   { ok: true, url: "https://…?token=…" }  |  { ok: false, motivo: "..." }
// verify_jwt = FALSE, y es obligatorio: la llama un cliente SIN cuenta. Queda declarado en
// `supabase/config.toml` — si no está ahí, el próximo deploy lo pone en true y la foto deja
// de cargar EN SILENCIO. [[norma-verify-jwt-se-conserva-no-se-impone]]
// ════════════════════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// El bucket donde el chofer sube la evidencia. No se recibe por parámetro: si se
// pudiera elegir, esto firmaría cualquier bucket del proyecto.
const BUCKET = "entregas";

// Cuánto vive la firma. Una visita a la página dura minutos; una hora cubre que
// alguien la deje abierta y vuelva, sin dejar un enlace útil por días.
const VIGENCIA_SEG = 3600;

// ⛔ CORS a mano: el runtime NO lo pone. Sin esto el navegador ni llega a hacer el
//    POST —se frena en el preflight— y desde afuera se ve como «la foto no carga».
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ⛔ DE LO GUARDADO A LA RUTA. Tres formas conviven en la base:
//    · URL pública:  https://<ref>.supabase.co/storage/v1/object/public/entregas/<ruta>
//    · URL firmada:  …/object/sign/entregas/<ruta>?token=…   (de alguna migración vieja)
//    · ruta pelada:  <ruta>                                   (lo que se guarda desde hoy)
//    Devuelve "" si no reconoce nada: mejor sin foto que firmando una ruta adivinada.
function rutaDe(guardado: string): string {
  const s = String(guardado || "").trim();
  if (!s) return "";
  for (const sep of [`/object/public/${BUCKET}/`, `/object/sign/${BUCKET}/`]) {
    const p = s.split(sep)[1];
    if (p) return decodeURIComponent(p.split("?")[0]);
  }
  // Una URL de otro sitio no se intenta firmar: no es nuestra.
  if (s.startsWith("http")) return "";
  return s.replace(new RegExp(`^${BUCKET}/`), "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "POST" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }
  const token = String(body?.token ?? "").trim();
  // Un token con forma rara ni se busca.
  if (!token || token.length > 120) return json({ ok: false, motivo: "sin token" }, 400);

  // ── LA FILA QUE ESE TOKEN IDENTIFICA ──────────────────────────────────────
  let fila: any = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/entregas?token=eq.${encodeURIComponent(token)}&select=foto_url&limit=1`,
      { headers: HDR },
    );
    if (!r.ok) return json({ ok: false, motivo: "no se pudo consultar" }, 502);
    fila = (await r.json())?.[0] ?? null;
  } catch {
    return json({ ok: false, motivo: "no se pudo consultar" }, 502);
  }

  // ⛔ El MISMO 404 para «no existe» y para «no tiene foto»: no se le confirma a
  //    nadie que un token es válido.
  const ruta = rutaDe(fila?.foto_url ?? "");
  if (!ruta) return json({ ok: false, motivo: "sin foto" }, 404);

  // ── LA FIRMA ──────────────────────────────────────────────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodeURI(ruta)}`, {
      method: "POST",
      headers: { ...HDR, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: VIGENCIA_SEG }),
    });
    if (!r.ok) {
      console.error("firmar", r.status, (await r.text()).slice(0, 200));
      return json({ ok: false, motivo: "no se pudo firmar" }, 502);
    }
    const d = await r.json();
    // La API devuelve la ruta firmada RELATIVA: se le pone el origen para que sirva
    // como `src` de una imagen sin que la página tenga que saber armarla.
    const rel = String(d?.signedURL ?? d?.signedUrl ?? "");
    if (!rel) return json({ ok: false, motivo: "no se pudo firmar" }, 502);
    return json({ ok: true, url: `${SUPABASE_URL}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}` });
  } catch (e) {
    console.error("firmar exc", String(e));
    return json({ ok: false, motivo: "no se pudo firmar" }, 502);
  }
});
