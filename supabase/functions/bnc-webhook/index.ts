import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY_ESPERADO = "de273ebdea7abce15e73d23cecad3ef70b4cd3b86ff60cf1980e01d7c7911a62";

// MIGRADO a WASSENGER (2026-07-17): 1 mensaje por pago NUEVO (al instante de recibirlo). Ya NO usa
// CallMeBot ni apikeys por número — encola en cola_mensajes y el worker antepone "♻️ Betangar:" y envía.
// ⛔ ACÁ NO VAN PERSONAS. Quién recibe cada aviso se le pregunta a la base con la
//    funcion `destinatarios(roles)` — ver `migraciones/quien_recibe_sale_de_la_base_2026-08-27.sql`.
//    Hasta el 27/08 esta lista tenía los cuatro socios escritos a mano, con la baja
//    de Auredy (06/08) y el alta de Alejandro Castillo (13/08) anotadas en
//    comentarios: cada movimiento de personal obligaba a tocar el repo y desplegar.
//    Jonaz y Alejandro ya están en la base con rol `banco`.
// ⚠️ `banco` es un rol aparte de `socios` A PROPÓSITO: ellos son socios del fondo y
//    pidieron enterarse de TODO ingreso al banco, pero nada más. Si estuvieran como
//    `socios` les llegaría todo lo demás, y eso nadie lo pidió.
const ROLES_DEL_AVISO = ["socios", "admin", "banco"];
// ⚠️ Último recurso si la base no contesta: este aviso es PLATA ENTRANDO, y un pago
//    del que nadie se entera es peor que un mensaje de más. Queda rastro en el log.
const SI_LA_BASE_NO_CONTESTA = ["584147379886"];

function parseFechaBNC(fecha: string, hora: string): string {
  if (!fecha || fecha.length < 8) return new Date().toISOString();
  const y = fecha.slice(0,4), m = fecha.slice(4,6), d = fecha.slice(6,8);
  const hh = hora ? hora.slice(0,2) : "00", mm = hora ? hora.slice(2,4) : "00";
  return `${y}-${m}-${d}T${hh}:${mm}:00Z`;
}

function labelTipo(tipo: string): string {
  const t: Record<string,string> = {DEP:"Deposito",TRF:"Transferencia",P2P:"Pago Movil",C2P:"Cobro Movil"};
  return t[tipo] || tipo;
}

// Códigos de banco (SUDEBAN). El BNC manda el código de 4 dígitos, no el nombre.
const BANCOS: Record<string,string> = {
  "0102":"Banco de Venezuela","0104":"Venezolano de Credito","0105":"Mercantil",
  "0108":"BBVA Provincial","0114":"Bancaribe","0115":"Banco Exterior","0116":"Banco Occidental de Descuento",
  "0128":"Banco Caroni","0134":"Banesco","0137":"Sofitasa","0138":"Banco Plaza","0146":"Bangente",
  "0151":"BFC Banco Fondo Comun","0156":"100% Banco","0157":"DelSur","0163":"Banco del Tesoro",
  "0166":"Banco Agricola de Venezuela","0168":"Bancrecer","0169":"Mi Banco","0171":"Banco Activo",
  "0172":"Bancamiga","0174":"Banplus","0175":"Banco Bicentenario","0177":"BANFANB","0178":"N58 Banco Digital",
  "0191":"BNC",
};
function labelBanco(codigo: string): string {
  const c = (codigo || "").trim();
  return BANCOS[c] || (c ? `Banco ${c}` : "");
}

serve(async (req) => {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey !== API_KEY_ESPERADO) {
    return new Response(JSON.stringify({error:"No autorizado"}), {status:401, headers:{"Content-Type":"application/json"}});
  }
  try {
    const body = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data, error } = await supabase.from("bnc_notificaciones").insert([{
      payload_raw:    JSON.stringify(body),
      cuenta_destino: body.CreditorAccount || "",
      cuenta_origen:  body.DebtorAccount || "",
      monto:          parseFloat(body.Amount || "0"),
      referencia:     body.DestinyBankReference || body.OriginBankReference || "",
      tipo:           body.PaymentType || "",
      tipo_label:     labelTipo(body.PaymentType || ""),
      fecha_recibido: parseFechaBNC(body.Date || "", body.Hour || ""),
      moneda:         body.CurrencyCode === "0840" ? "USD" : "VES",
      deudor_id:      body.DebtorID || "",
      concepto:       body.Concept || "",
      descripcion:    body.Concept || "",
      banco_origen:   body.OriginBankCode || "",
      banco_destino:  body.DestinyBankCode || "",
      procesado:      false,
    }]).select();

    if (error) {
      console.error("Error guardando:", JSON.stringify(error));
      return new Response(JSON.stringify({status:"error_guardado", detalle: error.message}), {status:200, headers:{"Content-Type":"application/json"}});
    }

    const dFecha = body.Date || "";
    const dHora  = body.Hour || "";
    const monto  = parseFloat(body.Amount || "0");
    const simbolo = body.CurrencyCode === "0840" ? "$" : "Bs ";
    // Sin prefijo "BETANGAR" — el worker antepone "♻️ Betangar:".
    const bancoOrigen = labelBanco(body.OriginBankCode || "");
    const lineaBanco = bancoOrigen ? `\nBanco: ${bancoOrigen}` : "";
    const waMsg  = `💰 Pago BNC Recibido\nTipo: ${labelTipo(body.PaymentType||"")}\nMonto: ${simbolo}${monto.toLocaleString("es-VE",{minimumFractionDigits:2})}${lineaBanco}\nRef: ${body.DestinyBankReference||body.OriginBankReference||""}\nDe: ${body.DebtorID||""}\nFecha: ${dFecha.slice(6,8)}/${dFecha.slice(4,6)}/${dFecha.slice(0,4)} ${dHora.slice(0,2)}:${dHora.slice(2,4)}`;

    // Destinatarios: se los pregunta a la base. Ya vienen normalizados y sin repetidos.
    let dest: string[] = [];
    try {
      const { data: dRows } = await supabase.rpc("destinatarios", { p_roles: ROLES_DEL_AVISO });
      dest = (dRows || []).map((d: any) => String(d.telefono));
    } catch (e) { console.error("destinatarios() no contesto:", e); }
    if (!dest.length) { dest = SI_LA_BASE_NO_CONTESTA.slice(); console.error("AVISO DEL BANCO SIN DESTINATARIOS en la base: sale solo al respaldo"); }
    // Encolar UNA vez por destinatario (el worker Wassenger antepone la etiqueta de empresa).
    const filas = dest.map((tel) => ({ telefono: tel, mensaje: waMsg, tipo: "bnc", estado: "pendiente" }));
    const { error: eCola } = await supabase.from("cola_mensajes").insert(filas);
    if (eCola) console.error("Error encolando WA:", eCola.message);

    return new Response(JSON.stringify({status:"ok", id:data?.[0]?.id, wa_encolados: filas.length}), {status:200, headers:{"Content-Type":"application/json"}});
  } catch(e: any) {
    return new Response(JSON.stringify({status:"error", mensaje:e.message}), {status:200, headers:{"Content-Type":"application/json"}});
  }
});
