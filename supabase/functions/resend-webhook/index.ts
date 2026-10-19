// ============================================================================
// EL WEBHOOK DE RESEND — los acuses del correo entran a nuestra base
// 2026-10-19. Decisión de Máximo: «hazlo con el webhook».
//
// POR QUÉ EXISTE: `enviar-correo-archivo.mjs` preguntaba el estado con
// `GET /emails/{id}` y recibía 401 — nuestra llave es de SOLO ENVÍO. La
// autocomprobación de la pieza estaba muda. Ampliar la llave no era opción:
// Resend solo tiene *Sending* y *Full access*, y lo segundo deja crear y revocar
// llaves. El webhook, además, atrapa el REBOTE TARDÍO, que es justo el que la
// consulta de 45 segundos no podía ver.
//
// ⛔ `verify_jwt=false` ES CORRECTO ACÁ Y NO HAY QUE «ARREGLARLO». Resend no
//    manda un JWT nuestro: manda una FIRMA. La guarda de esta puerta es la
//    verificación de abajo, igual que `bnc-webhook` se guarda con su api-key.
//    (La auditoría cuenta las funciones con `verify_jwt=false`; esta es de las
//    que tienen que estarlo.)
//
// ⛔ Y NO FALLA ABIERTO. Sin el secreto configurado devuelve 503 y NO escribe
//    nada. Una puerta que, cuando le falta la llave, deja pasar a todos es peor
//    que no tener puerta — y falla en silencio, que es lo que la hace durar.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// El secreto lo da Resend al crear el webhook en su panel (`whsec_…`). NO se
// escribe acá: este repositorio es público y una constante queda en la historia
// de git para siempre aunque después se borre del archivo.
const SECRETO = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

// Tolerancia de reloj, en segundos. Un evento con marca de hace horas que llega
// ahora es un REENVÍO de alguien que grabó la petición, no un acuse.
const TOLERANCIA = 5 * 60;

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// ── La firma de Svix, que es la que usa Resend ──────────────────────────────
// Se firma el texto `id.timestamp.cuerpo` con HMAC-SHA256, con la clave que sale
// de decodificar el secreto SIN el prefijo `whsec_`. La cabecera trae una LISTA
// («v1,aaa v1,bbb») porque durante una rotación valen dos: hay que aceptar que
// cualquiera case, no solo la primera.
function b64aBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// ⛔ Comparación de tiempo CONSTANTE. Un `===` sobre firmas se corta en el primer
//    byte distinto, y esa diferencia de tiempo le dice a quien mida cuántos bytes
//    acertó. Se comparan todas las posiciones siempre.
function igualSinFiltrar(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}
async function firmaValida(id: string, ts: string, cuerpo: string, cabecera: string): Promise<boolean> {
  const clave = await crypto.subtle.importKey(
    "raw", b64aBytes(SECRETO.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`${id}.${ts}.${cuerpo}`));
  const esperada = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return cabecera.split(" ").some((parte) => {
    const [ver, val] = parte.split(",");
    return ver === "v1" && val && igualSinFiltrar(val, esperada);
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "solo POST" }, 405);

  // ⛔ SIN SECRETO NO SE ESCRIBE NADA. Y se DICE que falta, con 503, para que
  //    Resend lo marque como fallando en vez de darlo por bueno.
  if (!SECRETO) {
    console.error("[resend-webhook] falta RESEND_WEBHOOK_SECRET: no se acepta ningun evento");
    return json({ error: "webhook sin configurar: falta el secreto de firma" }, 503);
  }

  // Svix manda las cabeceras con prefijo `svix-`; el estándar las admite también
  // como `webhook-`. Se aceptan las dos para no quedar colgados de un detalle.
  const h = (n: string) => req.headers.get(`svix-${n}`) || req.headers.get(`webhook-${n}`) || "";
  const id = h("id"), ts = h("timestamp"), firma = h("signature");
  if (!id || !ts || !firma) return json({ error: "faltan las cabeceras de firma" }, 400);

  const edad = Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10));
  if (!isFinite(edad) || edad > TOLERANCIA) return json({ error: "marca de tiempo fuera de rango" }, 400);

  // ⛔ EL CUERPO SE LEE COMO TEXTO Y SE FIRMA ASÍ, TAL CUAL. Parsearlo a JSON y
  //    volver a serializarlo cambia espacios y orden, y la firma deja de casar
  //    por un motivo que no tiene nada que ver con la seguridad.
  const cuerpo = await req.text();
  if (!(await firmaValida(id, ts, cuerpo, firma))) {
    console.error("[resend-webhook] firma invalida (svix-id " + id + ")");
    return json({ error: "firma invalida" }, 401);
  }

  let ev: any;
  try { ev = JSON.parse(cuerpo); } catch { return json({ error: "cuerpo ilegible" }, 400); }

  const d = ev?.data || {};
  const emailId = d.email_id || d.id || "";
  if (!emailId) return json({ error: "el evento no trae email_id" }, 400);

  // El motivo, cuando el evento lo trae. Un rebote sin motivo obliga a entrar al
  // panel de Resend para saber si fue una dirección mal escrita o un buzón lleno.
  const detalle =
    d?.bounce?.message || d?.bounce?.subType || d?.bounce?.type ||
    d?.complaint?.type || d?.failed?.reason || null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { error } = await supabase.from("correo_eventos").insert([{
    email_id:    emailId,
    tipo:        String(ev.type || "desconocido"),
    ocurrido_en: ev.created_at || new Date().toISOString(),
    destino:     Array.isArray(d.to) ? d.to : (d.to ? [d.to] : null),
    asunto:      d.subject || null,
    detalle,
    datos:       ev,
  }]);

  // ⛔ UN REENVÍO NO ES UN ERROR. Resend repite el evento si no contestamos 200 a
  //    tiempo; que el único choque posible sea la clave de unicidad es justo lo
  //    que hace que repetir sea inofensivo. 23505 = ya lo teníamos.
  if (error && error.code !== "23505") {
    console.error("[resend-webhook] no se pudo guardar:", error.message);
    // 500 a propósito: que Resend REINTENTE. Contestar 200 acá perdería el acuse
    // para siempre y el correo quedaría «sin noticias» sin que nadie lo sepa.
    return json({ error: "no se pudo guardar" }, 500);
  }

  console.log(`[resend-webhook] ${ev.type} · ${emailId}${error ? " (repetido)" : ""}`);
  return json({ ok: true });
});
