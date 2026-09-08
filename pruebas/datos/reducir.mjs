// Deja en `combustible.json` SOLO lo que la prueba necesita, y SIN una sola persona nombrada.
// El repo es PÚBLICO: la historia completa de un cliente que paga no vive acá.
// Se queda la GEOMETRÍA del caso —alturas, litros, fechas, el lote— que es justo lo que reproduce
// el defecto; se van los nombres (`conductor`, `chofer`, `registrado_por`) y todo lo que no hace falta.
import { readFileSync, writeFileSync } from 'fs'
const d = JSON.parse(readFileSync(new URL('./combustible-real.json', import.meta.url), 'utf8'))

const UNIDADES = ['JAC-B003', 'JAC-B012', 'JAC-B004', 'JAC-B002']
const DESDE = '2026-07-20', HASTA = '2026-08-31'
const dentro = (f) => { const x = String(f || '').slice(0, 10); return x >= DESDE && x <= HASTA }
const sinNombre = (o, ...campos) => { const c = { ...o }; campos.forEach((k) => { if (k in c) c[k] = '' }); return c }

const out = {
  // El lote del 18/08 va ENTERO aunque sus fechas sean de julio: es el testigo del caso 3.
  surt: d.surt.filter((s) => UNIDADES.includes(s.cam) || s.created_at === '2026-08-18 12:20:34.849141+00')
              .map((s) => sinNombre(s, 'chofer')),
  med: d.med.filter((m) => UNIDADES.includes(String(m.vehiculo_id)) && dentro(m.fecha))
            .map((m) => sinNombre(m, 'registrado_por')),
  ck: d.ck.filter((c) => UNIDADES.includes(String(c.cam)) && dentro(c.fecha))
          .map((c) => sinNombre(c, 'conductor')),
  gasoil: d.gasoil.filter((g) => UNIDADES.includes(String(g.cam)) && dentro(g.f)),
  tanques: d.tanques,   // geometría del tanque, no dato de nadie
}
writeFileSync(new URL('./combustible.json', import.meta.url), JSON.stringify(out))
const nombres = JSON.stringify(out).match(/[A-ZÁÉÍÓÚÑ]{3,}\s+[A-ZÁÉÍÓÚÑ]{3,}/g)
console.log('med', out.med.length, 'surt', out.surt.length, 'ck', out.ck.length, 'gasoil', out.gasoil.length)
console.log(nombres ? '⛔ QUEDARON NOMBRES: ' + [...new Set(nombres)].join(' · ') : '✅ sin nombres de personas')
