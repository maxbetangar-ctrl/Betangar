// ════════════════════════════════════════════════════════════════════════════════════════════
// RESUMEN-SOCIOS — el informe financiero del ciclo, en PDF, a los socios de Betangar
//
// 🔬 POR QUÉ EXISTE. Máximo, 28/10/2026: «mi socio Jonaz y Alejandro están necesitando
//    semanalmente un resumen que les llegue de manera automática de qué entró desde el momento
//    del pago de la alcaldía esta semana y qué salió [...] la alcaldía pagó tanto, tanto se fue
//    en combustible, tanto en nómina, tanto en pago a proveedores —que se le pagó tanto a cada
//    proveedor—, se compraron tantos dólares, que le abonaron a los camiones».
//
//    Los números no se calculan acá: salen de `btg_resumen_socios()`, en la base. Esta pieza
//    IMPRIME y ENTREGA. Si mañana el informe se quiere además en pantalla o por la puerta de
//    WhatsApp, lee la misma función y dice exactamente lo mismo. [[norma-fuente-unica-datos]]
//
// ⛔ EL PERÍODO LO MARCA EL PAGO, NO EL LUNES. `btg_ciclo_alcaldia()` da la ventana: arranca en
//    el cobro de la Alcaldía más viejo que todavía no se informó. Si la Alcaldía no pagó esta
//    semana, el informe SALE IGUAL y lo dice — un canal de entrega caído se ve exactamente igual
//    que «no había nada que contar», y por eso el silencio nunca es una opción.
//
// ⛔ NO MANDA FUERA DE 8:00–20:00 HORA DE VENEZUELA, y cuando está fuera NO registra la corrida:
//    queda para la corrida siguiente. Marcarla acá perdería el informe en silencio.
//    [[norma-hora-del-destinatario-antes-de-enviar]]
//
// ⛔ LO ESCRIBE Y LO FIRMA MÁXIMO. (28/10/2026: «no tiene ni el logo de Betangar ni mi firma, y
//    que esté llenado como si yo lo hubiese escrito».) Por eso el texto va en PRIMERA PERSONA
//    —«nos pagó», «pagamos», «nuestra deuda»— y se dirige a sus socios, nunca a nadie por su
//    nombre. Un texto impersonal debajo de una firma delata que no lo escribió quien firma.
//    [[norma-informe-mensual-va-al-dueno]] [[norma-no-nombrar-al-dueno-en-tercera-persona]]
//    ⛔ Y nada acá puede sonar a que lo redactó una máquina. [[norma-nada-que-insinue-ia-al-cliente]]
//
// ⛔ LA FIRMA MANUSCRITA SOLO SE DIBUJA SI ESTÁ CARGADA. Mientras `informe_membrete.firma_png_b64`
//    esté vacía queda la línea con el nombre y el cargo, que es un bloque de firma válido. No se
//    inventa una firma en un documento financiero. [[norma-documento-no-afirma-lo-que-nadie-declaro]]
//
// 📌 EL LOGO Y EL FIRMANTE SALEN DE `configuracion.informe_membrete`, no del código: cambiarlos
//    no puede exigir un despliegue.
//
// 📌 EL PDF NO LLEVA EMOJI. La fuente estándar de un PDF (Helvetica, WinAnsi) no los tiene: un
//    emoji no sale mal, hace FALLAR la escritura entera. Los acentos y la ñ sí entran.
//
// Dos puertas: la LLAVE (`x-api-key`, el cron) puede todo; la SESIÓN de una persona que puede
// ver el financiero solo puede MIRAR e IMPRIMIR — nunca disparar el envío a los socios.
//
// Uso:  POST /resumen-socios            → calcula, arma el PDF, lo manda y registra la corrida
//       POST /resumen-socios?dry=1      → devuelve los números y el texto, sin mandar ni registrar
//       POST /resumen-socios?pdf=1      → devuelve el PDF en crudo, para mirarlo antes de soltarlo
//       POST /resumen-socios&desde=&hasta=  → una ventana a mano (para rehacer un informe)
// ════════════════════════════════════════════════════════════════════════════════════════════
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const HORA_DESDE = 8;
const HORA_HASTA = 20;
// Los mismos que ya reciben el aviso del banco. Máximo los fijó ahí (02/09/2026) y son
// exactamente los que pidió para este informe: `socios` = él y Francisco, `banco` = Jonaz y
// Alejandro. `admin` entra sola el día que se cargue a la administradora, sin tocar código.
// Fuente única: si mañana entra o sale un socio, se cambia en UN solo sitio.
const ROLES = ["socios", "admin", "banco"];

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

// ⛔ EL MISMO CANDADO QUE `divisas-banco` Y `bnc-traer`. Se despliega sin verificación de JWT
// (así la llama el cron) y su respuesta trae el estado de cuenta entero: sin esto, cualquiera con
// la URL lo lee. Fail-closed, y la comparación en tiempo constante. [[norma-seguridad-dos-niveles]]
const FN_SECRET = Deno.env.get("BTG_FN_SECRET") || "";
function autorizado(req: Request): boolean {
  if (!FN_SECRET) return false;
  const k = req.headers.get("x-api-key") || "";
  if (k.length !== FN_SECRET.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ FN_SECRET.charCodeAt(i);
  return d === 0;
}

// ── La otra puerta: la PANTALLA ─────────────────────────────────────────────────────────────
// Máximo (28/10/2026): «¿debería haber un sitio en la app donde yo pueda imprimirlo por fechas?».
// Sí — y para eso el navegador tiene que poder llamar acá. Pero el navegador NO puede tener el
// secreto del cron: está en el HTML, lo lee cualquiera.
//
// ⛔ QUIÉN DECIDE ES LA BASE, NO ESTA FUNCIÓN. Se le pregunta a Postgres con el token de la
//    persona: si `btg_ve_financiero()` dice que sí, pasa. Así el permiso vive en UN solo sitio y
//    no hay una segunda lista de roles acá que se desincronice del día que cambie la de allá.
//    [[norma-dos-listas-a-mano-se-desincronizan]]
//
// ⛔ Y CON SESIÓN SOLO SE MIRA, NUNCA SE MANDA. El envío a los socios lo dispara el cron y nadie
//    más: un botón que le manda el informe a cuatro personas no puede quedar a un clic de
//    distancia en una pantalla. Por eso esta puerta solo abre `?pdf=1` y `?dry=1`.
async function puedeVerDesdeLaApp(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  // ⛔ El token de servicio NO entra por acá: si alguien lo pegara en el navegador, esta puerta
  //    no es la que tiene que dejarlo pasar. La de la llave es la otra.
  if (!token || token === SERVICE_KEY) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/btg_ve_financiero`, {
      method: "POST",
      headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") || "", Authorization: `Bearer ${token}`,
                 "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch (e) { console.error("puedeVerDesdeLaApp", String(e)); return false; }
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify(args),
  });
  if (!r.ok) { console.error("rpc", fn, r.status, await r.text()); return null; }
  return await r.json();
}

const ahoraVE = () => new Date(Date.now() - 4 * 3600 * 1000);
const horaVE = () => ahoraVE().getUTCHours();
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ddmm = (s: string) => { const p = String(s).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(s); };
function diaDe(s: string): string {
  const p = String(s).slice(0, 10).split("-");
  return p.length === 3 ? DIAS[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()] : "";
}
const n2 = (v: unknown, d = 2) =>
  Number(v || 0).toLocaleString("es-VE", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v: unknown) => "US$ " + n2(v);
const bs = (v: unknown) => "Bs " + n2(v);
// El PDF se escribe con Helvetica/WinAnsi: lo que esa fuente no tiene no se dibuja mal, hace
// fallar la escritura entera. Se limpia lo que el banco pueda traer de raro, nunca el contenido.
const limpio = (s: unknown) =>
  String(s ?? "").replace(/[^\x20-\x7E -ÿ]/g, "").trim();
// El nombre legal del proveedor es largo y la columna de montos no se puede correr.
const corto = (s: unknown, n: number) => { const t = limpio(s); return t.length <= n ? t : t.slice(0, n - 1) + "."; };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EL PDF
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function armarPdf(r: any, ciclo: any, empresa: string, membrete: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const TINTA = rgb(0.12, 0.12, 0.14);
  const SUAVE = rgb(0.42, 0.42, 0.46);
  const RAYA = rgb(0.82, 0.82, 0.85);
  const ROJO = rgb(0.68, 0.12, 0.12);
  const VERDE = rgb(0.06, 0.42, 0.24);

  const ANCHO = 595.28, ALTO = 841.89, M = 48;      // A4 vertical
  let pag = doc.addPage([ANCHO, ALTO]);
  let y = ALTO - M;

  // Cada vez que se va a escribir se pregunta si entra. Sin esto el informe de una semana con
  // muchos proveedores se escribe fuera de la hoja y nadie lo nota hasta que falta la mitad.
  const sitio = (h: number) => { if (y - h < M + 28) { pag = doc.addPage([ANCHO, ALTO]); y = ALTO - M; } };
  const txt = (s: string, x: number, size = 9.5, f = normal, color = TINTA) =>
    pag.drawText(limpio(s), { x, y, size, font: f, color });
  // Una fila de «concepto .......... monto»: el monto SIEMPRE alineado a la derecha, porque una
  // columna de números que no cuadra obliga a leerlos de a uno.
  //
  // ⛔ LA ETIQUETA SE CORTA POR ANCHO MEDIDO, NO POR CANTIDAD DE LETRAS. Contar caracteres no
  //    sirve: la fuente es de ancho variable y un concepto largo se mete ENCIMA del monto. Pasó
  //    en la primera prueba —«...de los camiones, 24/10/2026 (tasa 1.000,00)» se montó sobre
  //    «Bs 14.000.000,00» y las dos cifras quedaron ilegibles—. Acá se mide el monto, se mide la
  //    etiqueta y se recorta hasta que entre con un respiro. Así ningún texto futuro puede
  //    volver a pisar una cifra. [[norma-arreglar-el-mecanismo-no-el-caso]]
  const RESPIRO = 12;
  const fila = (etq: string, der: string, opts: { size?: number; bold?: boolean; color?: any; sangria?: number } = {}) => {
    const size = opts.size ?? 9.5;
    const f = opts.bold ? negrita : normal;
    sitio(size + 6);
    const d = limpio(der);
    const anchoD = f.widthOfTextAtSize(d, size);
    const x = M + (opts.sangria ?? 0);
    const disponible = (ANCHO - M - anchoD - RESPIRO) - x;
    let e = limpio(etq);
    if (f.widthOfTextAtSize(e, size) > disponible) {
      while (e.length > 1 && f.widthOfTextAtSize(e + "...", size) > disponible) e = e.slice(0, -1);
      e = e.replace(/[\s,(-]+$/, "") + "...";
    }
    pag.drawText(e, { x, y, size, font: f, color: opts.color ?? TINTA });
    pag.drawText(d, { x: ANCHO - M - anchoD, y, size, font: f, color: opts.color ?? TINTA });
    y -= size + 5;
  };
  const titulo = (s: string) => {
    sitio(34);
    y -= 10;
    txt(s.toUpperCase(), M, 10, negrita, TINTA);
    y -= 5;
    pag.drawLine({ start: { x: M, y }, end: { x: ANCHO - M, y }, thickness: 0.7, color: RAYA });
    y -= 13;
  };
  const nota = (s: string) => {
    // El pie de una sección explica de dónde salió el número de arriba. Va más chico y más
    // claro, pero va: un número que el dueño no puede explicar no sirve de nada.
    for (const linea of partir(limpio(s), 104)) { sitio(13); txt(linea, M, 8, normal, SUAVE); y -= 10.5; }
  };
  function partir(s: string, n: number): string[] {
    const out: string[] = []; let l = "";
    for (const p of s.split(" ")) { if ((l + " " + p).trim().length > n) { out.push(l.trim()); l = p; } else l += " " + p; }
    if (l.trim()) out.push(l.trim());
    return out;
  }

  // ── Membrete ───────────────────────────────────────────────────────────────────────────────
  // El logo sale de `configuracion.informe_membrete`, no del código: cambiarlo no puede exigir
  // un despliegue. Si no está o no se puede dibujar, el informe sale IGUAL con el nombre de la
  // empresa escrito — un papel sin logo se entiende; un informe que no sale, no.
  let altoLogo = 0;
  if (membrete?.logo_png_b64) {
    try {
      const img = await doc.embedPng(Uint8Array.from(atob(membrete.logo_png_b64), (c) => c.charCodeAt(0)));
      const anchoLogo = 136;
      altoLogo = (img.height / img.width) * anchoLogo;
      pag.drawImage(img, { x: M, y: y - altoLogo, width: anchoLogo, height: altoLogo });
    } catch (e) { console.error("logo", String(e)); altoLogo = 0; }
  }
  if (!altoLogo) { txt(empresa.toUpperCase(), M, 15, negrita); altoLogo = 19; }

  // A la derecha del logo, el título y el período. Alineado a la derecha para que el membrete
  // quede equilibrado con el logo a la izquierda.
  const der = (s: string, yy: number, size: number, f: any, color: any) =>
    pag.drawText(limpio(s), { x: ANCHO - M - f.widthOfTextAtSize(limpio(s), size), y: yy, size, font: f, color });
  const p = r.periodo;
  der("RESUMEN DEL CICLO", y - 11, 11, negrita, TINTA);
  der(`${ddmm(p.desde)} al ${ddmm(p.hasta)}  ·  ${p.dias} días`, y - 25, 9, normal, SUAVE);
  der(`Emitido el ${ddmm(ahoraVE().toISOString())}`, y - 37, 8, normal, SUAVE);

  y -= altoLogo + 14;
  pag.drawLine({ start: { x: M, y }, end: { x: ANCHO - M, y }, thickness: 1.3, color: TINTA });
  y -= 18;

  // ── La entrada, en primera persona ─────────────────────────────────────────────────────────
  // ⛔ ESTE INFORME LO FIRMA MÁXIMO Y ESTÁ ESCRITO COMO LO ESCRIBIRÍA ÉL (28/10/2026: «que esté
  //    llenado como si yo lo hubiese escrito»). Por eso habla en primera persona del plural —
  //    «nos pagó», «pagamos», «nuestra deuda»— y se dirige a sus socios. Un texto impersonal
  //    debajo de una firma delata que no lo escribió quien firma.
  //    ⛔ Y por eso mismo NADA acá puede sonar a que lo redactó una máquina.
  //    [[norma-nada-que-insinue-ia-al-cliente]] [[norma-no-nombrar-al-dueno-en-tercera-persona]]
  txt("Para mis socios:", M, 10, negrita); y -= 15;
  const entrada = (r.entro.alcaldia?.length)
    ? `Les resumo cómo se movió el dinero desde que la Alcaldía nos pagó. Están todos los `
      + `movimientos del banco de estos ${p.dias} días, en bolívares y en dólares, y abajo `
      + `detallo a quién le pagamos.`
    : `Les resumo cómo se movió el dinero en estos ${p.dias} días. La Alcaldía todavía no nos `
      + `volvió a pagar, así que seguimos dentro del mismo ciclo: lo que ven acá salió de lo que `
      + `entró la vez anterior.`;
  for (const l of partir(entrada, 100)) { sitio(14); txt(l, M, 9.5, normal, TINTA); y -= 12.5; }
  y -= 2;

  // ── ENTRÓ ──────────────────────────────────────────────────────────────────────────────────
  titulo("Entró");
  const alc: any[] = r.entro.alcaldia || [];
  if (alc.length) {
    for (const c of alc) {
      const pata = c.pata === "fiel" ? "fiel cumplimiento 10%" : c.pata === "neto" ? "neto" : String(c.pata);
      fila(`Alcaldía - factura ${c.factura} (${pata}), ${diaDe(c.fecha)} ${ddmm(c.fecha)}`,
           `${bs(c.bs)}   ${usd(c.usd)}`);
    }
  } else {
    fila("La Alcaldía no pagó en este período", "—", { color: ROJO });
  }
  for (const o of (r.entro.otros || [])) {
    fila(`${o.categoria} - ${corto(o.texto, 46)}, ${ddmm(o.fecha)}`, `${bs(o.bs)}   ${usd(o.usd)}`);
  }
  fila("TOTAL QUE ENTRÓ", usd(r.entro.total_usd), { bold: true, size: 10.5, color: VERDE });

  // ── SALIÓ: GASTO ───────────────────────────────────────────────────────────────────────────
  titulo("Salió - gasto de la operación");
  const NOMBRE: Record<string, string> = {
    nomina: "Nómina", combustible: "Combustible (gasoil)", mantenimiento: "Mantenimiento y repuestos",
    impuestos: "Impuestos", seguro: "Seguro", servicios: "Servicios", alquiler: "Alquiler",
    resp_social: "Responsabilidad social 3%", asignacion_1b: "Asignación 1B", pago_socio: "Pago a socio",
    software: "Software", comision_banco: "Comisiones del banco", otro: "Otros gastos",
    sin_clasificar: "SIN CLASIFICAR todavía",
  };
  for (const c of (r.salio_gasto.por_categoria || [])) {
    fila(`${NOMBRE[c.categoria] ?? c.categoria} (${c.n} ${c.n === 1 ? "movimiento" : "movimientos"})`,
         `${bs(c.bs)}   ${usd(c.usd)}`,
         { color: c.categoria === "sin_clasificar" ? ROJO : TINTA });
  }
  fila("TOTAL GASTO", usd(r.salio_gasto.total_usd), { bold: true, size: 10.5, color: ROJO });

  // ── SALIÓ: NO ES GASTO ─────────────────────────────────────────────────────────────────────
  titulo("Salió del banco, pero NO es gasto");
  const cam: any[] = r.salio_no_gasto.camiones || [];
  for (const c of cam) {
    fila(`Abono a la deuda de los camiones, ${ddmm(c.fecha)} (dólares comprados a ${n2(c.tasa, 2)})`,
         `${bs(c.bs)}   ${usd(c.usd)}`);
  }
  for (const d of (r.salio_no_gasto.divisas_sin_destino || [])) {
    fila(`Dólares comprados sin destino declarado, ${ddmm(d.fecha)} - ${limpio(d.texto)}`,
         `${bs(d.bs)}   ${usd(d.usd)}`, { color: ROJO });
  }
  if (!cam.length && !(r.salio_no_gasto.divisas_sin_destino || []).length) fila("Nada en este período", "—");
  fila("TOTAL QUE SALIÓ SIN SER GASTO", usd(r.salio_no_gasto.total_usd), { bold: true, size: 10.5 });
  nota("Quiero que quede claro que esto no nos empobrece: son los mismos dólares, solo que en otro lado. "
     + "Con ese abono bajamos nuestra deuda de los camiones, que es patrimonio nuestro; de la cuota, "
     + "gasto es nada más la parte de intereses. Si lo sumáramos junto con la nómina y el gasoil, "
     + "nuestra utilidad se vería más baja de lo que realmente es.");

  // ── EL SALDO ───────────────────────────────────────────────────────────────────────────────
  titulo("Cómo quedó el ciclo");
  fila("Entró", usd(r.entro.total_usd));
  fila("Menos el gasto de la operación", "-" + usd(r.salio_gasto.total_usd));
  fila("Menos lo que salió sin ser gasto", "-" + usd(r.salio_no_gasto.total_usd));
  fila("DIFERENCIA DEL CICLO", usd(r.saldo_usd),
       { bold: true, size: 11.5, color: Number(r.saldo_usd) >= 0 ? VERDE : ROJO });
  nota("Ojo: esta es la diferencia entre lo que entró y lo que salió en estos días, no es nuestra "
     + "utilidad del mes. Tenemos gastos que ya debemos y todavía no salieron del banco, y trabajo que "
     + "ya ejecutamos y aún no facturamos. Tampoco cuento los traspasos entre nuestras propias cuentas, "
     + "que no entran ni salen.");

  // ── PROVEEDOR POR PROVEEDOR ────────────────────────────────────────────────────────────────
  titulo("A quién se le pagó");
  const prov: any[] = r.proveedores || [];
  const ident = prov.filter((x) => x.identificado);
  const anon = prov.filter((x) => !x.identificado);
  if (!prov.length) fila("No hubo pagos a proveedores en este período", "—");
  for (const x of ident) {
    fila(`${corto(x.nombre, 52)} (${x.n} ${x.n === 1 ? "pago" : "pagos"})`, `${bs(x.bs)}   ${usd(x.usd)}`);
  }
  for (const x of anon) {
    // ⛔ Lo que no se pudo atribuir NO se esconde en «otros»: se nombra, con el texto del banco,
    //    para que alguien lo pueda reconocer y cargar. Un total que cuadra tapando lo que no
    //    entendió es peor que uno que avisa.
    fila(`Sin identificar - ${x.n} ${x.n === 1 ? "pago" : "pagos"}, p. ej. ${limpio(x.muestra)}`,
         `${bs(x.bs)}   ${usd(x.usd)}`, { color: SUAVE });
  }
  nota("El nombre lo saco del texto del banco: por el RIF cuando lo trae, y si no por el nombre. Lo que "
     + "no pude atribuir con certeza lo dejo aparte en vez de repartirlo entre los demás; en cuanto "
     + "carguemos a esos beneficiarios en Proveedores van a aparecer con su nombre. La nómina, los "
     + "impuestos y las comisiones del banco no los pongo acá porque no son proveedores a quienes "
     + "reclamarles.");

  // ── LO QUE HAY QUE MIRAR ───────────────────────────────────────────────────────────────────
  const av = r.avisos || {};
  const fiel: any[] = av.fiel_sin_entrar || [];
  const atrasadas = fiel.filter((f: any) => !f.en_plazo);
  const sc = av.sin_clasificar || {};
  if (atrasadas.length || Number(sc.n) > 0 || Number(av.movimientos_sin_tasa) > 0) {
    titulo("Lo que quiero que miren");
    if (atrasadas.length) {
      fila(`Fiel cumplimiento 10% que la Alcaldía todavía no devolvió (${atrasadas.length} facturas)`,
           bs(av.fiel_atrasada_bs), { bold: true, color: ROJO });
      for (const f of atrasadas) {
        fila(`factura ${f.factura}, cobrada el ${ddmm(f.desde)} - ${f.dias} días`,
             `${bs(f.fiel_estimada_bs)} aprox.`, { size: 8.5, sangria: 14, color: SUAVE });
      }
      nota("La Alcaldía nos retiene el 10% de cada factura y nos lo devuelve días después, en un depósito "
         + "aparte. De estas facturas cobramos el neto y ese depósito todavía no aparece en el estado de "
         + "cuenta. El monto que pongo es estimado a partir del neto que sí entró; el exacto lo tiene cada "
         + "factura. Es plata nuestra que está afuera.");
    }
    if (Number(sc.n) > 0) {
      y -= 6;
      fila(`Movimientos que salieron sin clasificar (${sc.n})`, `${bs(sc.bs)}   ${usd(sc.usd)}`, { color: ROJO });
      nota("Los estoy contando como gasto porque salieron del banco, pero todavía no tenemos declarado a qué "
         + "fueron. Hasta que los clasifiquemos, ese monto puede estar en la columna equivocada.");
    }
    if (Number(av.movimientos_sin_tasa) > 0) {
      y -= 6;
      fila(`Movimientos sin tasa del día, que no se pudieron pasar a dólares`, String(av.movimientos_sin_tasa), { color: ROJO });
      nota("Sus bolívares sí los estoy contando; sus dólares no. El total en US$ de este resumen se queda "
         + "corto en esos movimientos hasta que carguemos la tasa de esos días.");
    }
  }

  // ── Cierre y firma ─────────────────────────────────────────────────────────────────────────
  // ⛔ LA FIRMA NO SE PARTE DE SU DESPEDIDA. `sitio()` se pide UNA vez para el bloque entero:
  //    si se pidiera renglón por renglón, una firma podría quedar sola arriba de una hoja nueva,
  //    separada del texto que firma — y un papel así no lo firma nadie.
  sitio(132);
  y -= 10;
  pag.drawLine({ start: { x: M, y }, end: { x: ANCHO - M, y }, thickness: 0.7, color: RAYA });
  y -= 14;
  nota(`Lo armé con el estado de cuenta del banco, movimiento por movimiento. Cada uno lo pasé a `
     + `dólares con la tasa de su propio día -y con la tasa que pactamos, no la del BCV, cuando fue `
     + `una compra de divisas-. Cualquier cifra de acá se la puedo mostrar movimiento por movimiento.`);
  y -= 10;
  txt("Quedo a la orden,", M, 9.5, normal, TINTA);
  y -= 46;

  // La firma MANUSCRITA, si está cargada en `configuracion.informe_membrete`. Mientras no esté,
  // queda la línea con el nombre y el cargo debajo, que es un bloque de firma válido.
  // ⛔ NO SE DIBUJA NINGUNA FIRMA QUE NO HAYA DECLARADO SU DUEÑO. Una firma inventada en un
  //    documento financiero no es un detalle de diseño. [[norma-documento-no-afirma-lo-que-nadie-declaro]]
  if (membrete?.firma_png_b64) {
    try {
      const img = await doc.embedPng(Uint8Array.from(atob(membrete.firma_png_b64), (c) => c.charCodeAt(0)));
      const anchoF = Math.min(160, (img.width / img.height) * 42);
      pag.drawImage(img, { x: M, y: y + 6, width: anchoF, height: (img.height / img.width) * anchoF });
    } catch (e) { console.error("firma", String(e)); }
  }
  pag.drawLine({ start: { x: M, y }, end: { x: M + 210, y }, thickness: 0.8, color: TINTA });
  y -= 13;
  txt(membrete?.firmante || "", M, 10, negrita, TINTA); y -= 12;
  txt(membrete?.cargo || "", M, 9, normal, SUAVE); y -= 11;
  txt(empresa, M, 9, normal, SUAVE);

  // ── «Página N de M», al final de todo ──────────────────────────────────────────────────────
  // Se escribe acá porque recién ahora se sabe CUÁNTAS páginas son. Y se escribe siempre, aunque
  // sea una sola: un documento financiero del que se traspapela una hoja no avisa, y el que lo
  // lee no tiene cómo darse cuenta de que le falta la mitad de los proveedores.
  const hojas = doc.getPages();
  hojas.forEach((h, i) => {
    const t = `Página ${i + 1} de ${hojas.length}`;
    h.drawText(t, {
      x: ANCHO - M - normal.widthOfTextAtSize(t, 8), y: M - 14, size: 8, font: normal, color: SUAVE,
    });
  });

  return await doc.save();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const u = new URL(req.url);
  const dry = u.searchParams.get("dry") === "1";
  const soloPdf = u.searchParams.get("pdf") === "1";

  // Dos puertas. La LLAVE (el cron) puede todo; la SESIÓN solo puede mirar e imprimir.
  const conLlave = autorizado(req);
  const conSesion = conLlave ? false : await puedeVerDesdeLaApp(req);
  if (!conLlave && !conSesion) return json({ error: "No autorizado" }, 401);
  if (conSesion && !soloPdf && !dry) {
    return json({ error: "Desde la app el informe se mira y se imprime; el envío a los socios lo hace la corrida de los lunes." }, 403);
  }

  try {

    // ── La ventana ───────────────────────────────────────────────────────────────────────────
    let desde = u.searchParams.get("desde");
    let hasta = u.searchParams.get("hasta");
    let ciclo: any = null;
    if (!desde || !hasta) {
      const c = await rpc("btg_ciclo_alcaldia");
      ciclo = Array.isArray(c) ? c[0] : c;
      if (!ciclo) return json({ ok: false, error: "btg_ciclo_alcaldia no devolvió nada" }, 500);
      desde = ciclo.desde; hasta = ciclo.hasta;
    }

    const r = await rpc("btg_resumen_socios", { p_desde: desde, p_hasta: hasta });
    if (!r) return json({ ok: false, error: "btg_resumen_socios no devolvió nada" }, 500);

    // ── Con qué sale ─────────────────────────────────────────────────────────────────────────
    // ⛔ LAS HERRAMIENTAS SE COMPRUEBAN AL ARRANCAR, no cuando ya se usaron. Una pieza automática
    //    a la que le falta la credencial falla en silencio y se ve igual que «no había nada».
    const cfgW = await sel("configuracion?clave=eq.wassenger&select=valor");
    let w: any = {};
    try { w = JSON.parse(cfgW[0]?.valor ?? "{}"); } catch { w = typeof cfgW[0]?.valor === "object" ? cfgW[0].valor : {}; }
    // El membrete: el logo, quién firma y con qué cargo. Vive en la CONFIGURACIÓN y no en el
    // código para que cambiar el logo o el firmante no exija desplegar — y para poder pegarle la
    // firma escaneada el día que exista, sin tocar nada. [[norma-arreglar-el-mecanismo-no-el-caso]]
    const cfgM = await sel("configuracion?clave=eq.informe_membrete&select=valor");
    let membrete: any = {};
    try { membrete = JSON.parse(cfgM[0]?.valor ?? "{}"); }
    catch { membrete = typeof cfgM[0]?.valor === "object" ? cfgM[0].valor : {}; }

    const cfgE = await sel("configuracion?clave=eq.empresa&select=valor");
    let emp: any = {};
    try { emp = JSON.parse(cfgE[0]?.valor ?? "{}"); } catch { emp = typeof cfgE[0]?.valor === "object" ? cfgE[0].valor : {}; }
    const empresa = (emp?.nombre || "Inversiones Betangar, C.A.").trim();

    const cfgWA = await sel("configuracion?clave=eq.whatsapp&select=valor");
    let wa: any[] = [];
    try { wa = JSON.parse(cfgWA[0]?.valor || "[]"); } catch { wa = []; }
    const nums = Array.from(new Set((Array.isArray(wa) ? wa : [])
      .filter((x: any) => x.num && x.activo && ROLES.includes(x.rol))
      .map((x: any) => String(x.num).replace(/[\s\-+]/g, ""))));

    const faltan: string[] = [];
    if (!w?.token) faltan.push("configuracion.wassenger.token");
    if (!nums.length) faltan.push("configuracion.whatsapp sin ningún destino activo en los roles " + ROLES.join("/"));
    // ⛔ Un informe que sale sin firmante no es el que se pidió: se planta y lo dice.
    if (!membrete?.firmante) faltan.push("configuracion.informe_membrete sin `firmante`: el informe va firmado");
    // El logo NO se planta a propósito: sin logo el informe se entiende igual, y dejar a los
    // socios sin su resumen por un asunto de presentación sería peor. Queda avisado y sale.
    const sinLogo = !membrete?.logo_png_b64;

    // ── El PDF ───────────────────────────────────────────────────────────────────────────────
    const pdf = await armarPdf(r, ciclo, empresa, membrete);
    const nombre = `Betangar - resumen del ciclo ${String(desde).slice(0, 10)} al ${String(hasta).slice(0, 10)}.pdf`;

    if (soloPdf) {
      return new Response(pdf, { headers: { "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nombre}"`, ...CORS } });
    }

    // El pie del documento. Corto a propósito: el detalle está en el PDF, y un pie largo tapa el
    // adjunto en la pantalla del teléfono.
    const pie =
      `Les paso el resumen del ${ddmm(String(desde))} al ${ddmm(String(hasta))}.\n\n` +
      (r.entro.alcaldia?.length
        ? `Nos pagó la Alcaldía: ${usd(r.entro.alcaldia_usd)}\n`
        : `La Alcaldía todavía no nos volvió a pagar.\n`) +
      `Gastamos en la operación: ${usd(r.salio_gasto.total_usd)}\n` +
      (Number(r.salio_no_gasto.camiones_usd) > 0
        ? `Abonamos a los camiones: ${usd(r.salio_no_gasto.camiones_usd)}\n` : "") +
      `Diferencia del ciclo: ${usd(r.saldo_usd)}\n\n` +
      `En el documento les detallo a quién le pagamos.`;

    const h = horaVE();
    const enFranja = h >= HORA_DESDE && h < HORA_HASTA;

    if (dry) {
      return json({ ok: true, dry: true, hora_ve: h, en_franja: enFranja, ciclo,
        periodo: { desde, hasta }, destinos: nums, faltan, sin_logo: sinLogo,
        firmante: membrete?.firmante ?? null, firma_escaneada: !!membrete?.firma_png_b64,
        pdf_bytes: pdf.length, pie, resumen: r });
    }
    if (faltan.length) return json({ ok: false, error: "faltan herramientas", faltan }, 500);
    // ⛔ Fuera de hora NO se registra la corrida: si se registrara, el informe de esta semana
    //    quedaría dado por entregado sin haber salido, y el de la semana que viene empezaría
    //    después de un período que nadie leyó.
    if (!enFranja) return json({ ok: true, enviado: false, motivo: "fuera de la franja 8-20 de Venezuela", hora_ve: h });

    // ── Subir el documento y encolar ─────────────────────────────────────────────────────────
    // Wassenger no recibe los bytes junto con el mensaje: primero el archivo, después su id.
    const fd = new FormData();
    fd.append("file", new Blob([pdf], { type: "application/pdf" }), nombre);
    const sub = await fetch("https://api.wassenger.com/v1/files", { method: "POST", headers: { Token: w.token }, body: fd });
    const subTxt = await sub.text();
    if (!sub.ok && sub.status !== 201) {
      return json({ ok: false, error: `no se pudo subir el PDF (HTTP ${sub.status})`, detalle: subTxt.slice(0, 400) }, 502);
    }
    let fid: string | null = null;
    try {
      const j = JSON.parse(subTxt);
      fid = j?.id || (Array.isArray(j) ? j[0]?.id : null);
    } catch { /* abajo se avisa */ }
    if (!fid) return json({ ok: false, error: "el proveedor no devolvió el id del archivo", detalle: subTxt.slice(0, 400) }, 502);

    const filas = nums.map((t) => ({
      telefono: t, mensaje: pie, tipo: "resumen_socios", estado: "pendiente",
      media_file: fid, media_nombre: nombre,
    }));
    const enc = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
      method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(filas),
    });
    if (!enc.ok) return json({ ok: false, error: `no se pudo encolar (HTTP ${enc.status})`, detalle: (await enc.text()).slice(0, 300) }, 500);

    // Recién acá se registra: con el documento subido y las filas en la cola. Antes de esto, un
    // registro diría que el informe salió cuando no salió, y el próximo empezaría tarde.
    await fetch(`${SUPABASE_URL}/rest/v1/btg_resumen_socios_corridas`, {
      method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ desde, hasta, destinos: nums, resumen: r }),
    });

    return json({ ok: true, enviado: true, periodo: { desde, hasta }, destinos: nums.length,
      archivo: nombre, pdf_bytes: pdf.length, arranque: ciclo?.arranque ?? "a mano" });
  } catch (e) {
    console.error("resumen-socios", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
});
