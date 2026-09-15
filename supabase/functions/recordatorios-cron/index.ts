import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — recordatorios por rol/hora por WhatsApp.
// MIGRADO a WASSENGER (2026-07-17): ya NO usa CallMeBot. Solo ENCOLA en cola_mensajes; el worker
// procesar_cola_wassenger antepone la etiqueta de la empresa ("♻️ Betangar:") y envía por Wassenger.
// Ya NO exige apikey por número (eso era de CallMeBot): basta con que el empleado/rol tenga whatsapp.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const GRACIA_MIN = 90; // ventana de envio tardio (si una corrida se salto)

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel err", path, r.status, await r.text()); return []; }
  return await r.json();
}

// Encola en cola_mensajes (el worker Wassenger antepone la etiqueta de empresa y normaliza el número).
async function enqueue(rows: any[]) {
  if (!rows.length) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error("cola insert err", r.status, await r.text());
}

function veNow(): Date { return new Date(Date.now() - 4 * 3600 * 1000); } // Venezuela UTC-4
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function hhmm(s: string): number { const p = String(s || "").split(":"); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }

function rolMatch(rol: string, cargo: string): boolean {
  cargo = (cargo || "").toLowerCase();
  switch (rol) {
    case "chofer": return cargo.includes("chofer");
    case "vigilante": return cargo.includes("vigilante") || cargo.includes("porteria");
    case "mecanica": return cargo.includes("mec");
    case "operativo": return cargo.includes("oper");
    case "admin": return cargo.includes("admin") || cargo.includes("administr");
    case "rrhh": return cargo.includes("rrhh") || cargo.includes("recursos");
    default: return false;
  }
}
function tpl(msg: string, e: any): string {
  const nom = e ? String(e.nombre || "").trim().split(/\s+/)[0] : "";
  const uni = e ? (e.unidad || "tu unidad") : "tu unidad";
  return String(msg || "").replace(/\[nombre\]/g, nom).replace(/\[su unidad\]/g, uni).replace(/\[unidad\]/g, uni);
}

const preview: any[] = [];
// Encola un mensaje a un número. El worker antepone "♻️ Betangar:" → aquí va SIN prefijo.
const pend: any[] = [];
const yaEncolado = new Set<string>(); // evita duplicar mismo num+mensaje en la misma corrida
function waSend(num: string, text: string, dry: boolean) {
  const n = String(num || "").replace(/[\s\-\+]/g, "");
  if (!n || !text) return;
  const dedupeKey = `${n}::${text}`;
  if (yaEncolado.has(dedupeKey)) return; // ya se le mandó este mismo texto (p.ej. empleado + num empresarial)
  yaEncolado.add(dedupeKey);
  if (dry) { preview.push({ num: n, text }); return; }
  pend.push({ telefono: n, mensaje: text, tipo: "recordatorio", estado: "pendiente" });
}

async function yaEnviado(key: string, dry: boolean): Promise<boolean> {
  const rows = await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`);
  if (rows.length) return true;
  if (dry) return false;
  await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
  return false;
}

Deno.serve(async (_req: Request) => {
  try {
    const dry = new URL(_req.url).searchParams.get("dry") === "1";
    preview.length = 0; pend.length = 0; yaEncolado.clear();
    const now = veNow();
    const hoy = ymd(now);
    const minNow = now.getUTCHours() * 60 + now.getUTCMinutes();
    const debe = (hora: string) => { const dif = minNow - hhmm(hora); return dif >= 0 && dif <= GRACIA_MIN; };

    // Config de recordatorios (misma clave que edita la app)
    const cfgRec = await sel(`configuracion?clave=eq.recordatorios_cfg&select=valor`);
    let roles: any[] = [], todos: any = null;
    try { const d = JSON.parse(cfgRec[0]?.valor || "{}"); roles = d.roles || []; todos = d.todos || null; } catch { /* */ }
    if (!roles.length && !todos) return new Response(JSON.stringify({ ok: false, msg: "sin recordatorios_cfg" }), { headers: { "Content-Type": "application/json" } });

    // Numeros empresariales por rol (opcional). Con Wassenger ya no hace falta apikey: basta num.
    const cfgEmp = await sel(`configuracion?clave=eq.wa_empresarial&select=valor`);
    let waEmp: any[] = [];
    try { waEmp = JSON.parse(cfgEmp[0]?.valor || "[]"); } catch { waEmp = []; }
    const empRol = (rol: string) => waEmp.find((r: any) => r.rol === rol && r.activo && r.num);

    const emps = await sel(`empleados?select=nombre,cargo,unidad,whatsapp,activo`);
    const activos = emps.filter((e: any) => e.activo !== false && e.whatsapp);

    let enviados = 0;
    let omitidos = 0;
    let sin_unidad = 0;
    const sentKeys: string[] = [];

    // ── «SOLO AL QUE NO LO HIZO» ────────────────────────────────────────────
    // 🔴 POR QUÉ, 14/09/2026. Máximo: «quiero eliminar muchos recordatorios, creo
    //    que estamos enviando demasiadas cosas». Medido antes de tocar: el tipo
    //    `recordatorio` son **32 mensajes por día a 18 personas**, y salían TODOS
    //    los días hubiera o no algo pendiente. Un aviso que llega los 30 días del
    //    mes no avisa de nada: enseña a ignorarlo.
    //
    // ⛔ NO se cableó «si es el rol chofer a las 05:00, mirá el checklist». Eso
    //    ata el código a una fila de una configuración que se edita desde la app:
    //    el día que alguien cambie la hora, el candado deja de aplicar y nadie se
    //    entera. Se declara EN LA CONFIGURACIÓN, con `omitir_si`, y el código solo
    //    sabe resolver condiciones. [[norma-arreglar-el-mecanismo-no-el-caso]]
    //
    // ── LA UNIDAD TIENE QUE EXISTIR EN LA FLOTA ─────────────────────────────
    // 🔴 15/09/2026. Dos empleados con cargo «Chofer» tienen como unidad
    //    `ADM - Administrativo`, que **no está en `km_data`** (13 unidades, todas
    //    JAC-B0XX) y **nunca tuvo un checklist**. Les llegaba todos los días
    //    «Recuerda hacer el checklist del camión ADM - Administrativo»: un
    //    recordatorio de algo que no se puede hacer, porque el vehículo no está
    //    en el sistema de checklist.
    // ⛔ Se resuelve contra una TABLA, no con una lista de nombres: si mañana el
    //    vehículo administrativo entra a `km_data`, el recordatorio empieza a
    //    salir solo. Y si se va un camión, deja de salir solo. Una excepción
    //    escrita a mano acá habría que acordarse de sacarla.
    //    [[norma-arreglar-el-mecanismo-no-el-caso]]
    // ⚠️ Solo aplica a los mensajes que declaran un `omitir_si` de unidad: los
    //    recordatorios que NO hablan de una unidad (administración, RRHH) no se
    //    tocan. Y los dos siguen recibiendo todo lo demás.
    // ⚠️ Sin unidad NINGUNA también cae acá, y es a propósito: el texto pondría
    //    «el checklist del camión tu unidad», que no le dice nada a nadie.
    //    Se cuenta APARTE de los «ya lo hizo» (`sin_unidad` vs `omitidos`): uno
    //    es el mecanismo funcionando y el otro es un dato mal puesto que alguien
    //    tiene que arreglar. Un solo contador los taparía.
    //    [[norma-numero-que-el-dueno-no-puede-explicar]]
    let flota: Set<string> | null = null;
    async function unidadDeLaFlota(unidad: string): Promise<boolean> {
      const uni = String(unidad || "").trim().toUpperCase();
      if (!uni) return false;
      if (!flota) {
        const rows = await sel(`km_data?select=cam`);
        flota = new Set(rows.map((r: any) => String(r.cam || "").trim().toUpperCase()));
      }
      return flota.has(uni);
    }

    const cacheHecho: Record<string, Set<string>> = {};
    async function yaLoHizo(cond: string, unidad: string): Promise<boolean> {
      const uni = String(unidad || "").trim().toUpperCase();
      if (!uni) return false;                       // sin unidad → se le avisa igual
      if (!cacheHecho[cond]) {
        let q = "";
        if (cond === "checklist_hoy")      q = `checklist?fecha=eq.${hoy}&select=cam`;
        else if (cond === "viajes_hoy")    q = `viajes_chofer?fecha=eq.${hoy}&select=cam`;
        // ⚠️ `checklist_reciente` mira DOS días, no «ayer». Con «ayer» a secas, el
        //    lunes nadie califica —el domingo no se trabaja— y los 13 choferes
        //    reciben el recordatorio igual. Dos días hace que el sábado cuente.
        //    La hora es la del NEGOCIO: `hoy` ya viene de `veNow()`.
        else if (cond === "checklist_reciente") q = `checklist?fecha=gte.${ymd(new Date(veNow().getTime() - 2 * 864e5))}&select=cam`;
        else return false;                          // condición desconocida → se avisa
        const rows = await sel(q);
        cacheHecho[cond] = new Set(rows.map((r: any) => String(r.cam || "").trim().toUpperCase()));
      }
      return cacheHecho[cond].has(uni);
    }

    // Recordatorios por ROL
    for (const rc of roles) {
      if (!rc || !rc.activo || !Array.isArray(rc.mensajes)) continue;
      for (const m of rc.mensajes) {
        if (!m || !m.activo || !debe(m.hora)) continue;
        const key = `rec_${rc.rol}_${String(m.hora).replace(":", "")}_${hoy}`;
        if (await yaEnviado(key, dry)) continue;
        sentKeys.push(key);
        const dests = activos.filter((e: any) => rolMatch(rc.rol, e.cargo));
        for (const e of dests) {
          if (m.omitir_si) {
            // Dos motivos DISTINTOS para no mandarlo, y se cuentan aparte: uno es
            // «ya lo hizo» (bueno) y el otro «esa unidad no existe» (un dato mal
            // puesto). Sumarlos daría un número que nadie sabría explicar.
            if (!(await unidadDeLaFlota(e.unidad))) { sin_unidad++; continue; }
            if (await yaLoHizo(String(m.omitir_si), e.unidad)) { omitidos++; continue; }
          }
          waSend(e.whatsapp, tpl(m.msg, e), dry); enviados++;
        }
        const we = empRol(rc.rol);
        if (we) { waSend(we.num, tpl(m.msg, null), dry); enviados++; }
      }
    }

    // Recordatorio para TODOS (excluye socios/directivo: solo empleados y empresariales)
    if (todos && todos.activo && debe(todos.hora)) {
      const key = `rec_todos_${String(todos.hora).replace(":", "")}_${hoy}`;
      if (!(await yaEnviado(key, dry))) {
        sentKeys.push(key);
        for (const e of activos) { waSend(e.whatsapp, todos.msg, dry); enviados++; }
        for (const r of waEmp) { if (r.activo && r.num) { waSend(r.num, todos.msg, dry); enviados++; } }
      }
    }

    if (!dry) await enqueue(pend);

    return new Response(JSON.stringify({ ok: true, dry, ve_hora: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`, enviados, omitidos, sin_unidad, encolados: pend.length, claves: sentKeys, choferes_activos: activos.filter((e:any) => rolMatch("chofer", e.cargo)).length, preview: dry ? preview : undefined }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("recordatorios-cron error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
