import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const BNC_BASE = 'https://servicios.bncenlinea.com:16500/api';
const SALT = new Uint8Array([
  0x49,
  0x76,
  0x61,
  0x6e,
  0x20,
  0x4d,
  0x65,
  0x64,
  0x76,
  0x65,
  0x64,
  0x65,
  0x76
]);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const JSON_HEADERS = {
  'Content-Type': 'application/json'
};
function utf8(s) {
  return new TextEncoder().encode(s);
}
function utf16le(s) {
  const b = new Uint8Array(s.length * 2);
  for(let i = 0; i < s.length; i++){
    const c = s.charCodeAt(i);
    b[i * 2] = c & 0xff;
    b[i * 2 + 1] = c >> 8 & 0xff;
  }
  return b;
}
function fromUtf16le(bytes) {
  let s = '';
  for(let i = 0; i + 1 < bytes.length; i += 2){
    s += String.fromCharCode(bytes[i] | bytes[i + 1] << 8);
  }
  return s;
}
function b64encode(buf) {
  const b = new Uint8Array(buf);
  let bin = '';
  for(let i = 0; i < b.length; i++)bin += String.fromCharCode(b[i]);
  return btoa(bin);
}
function b64decode(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++)b[i] = bin.charCodeAt(i);
  return b;
}
function toHex(buf) {
  const b = new Uint8Array(buf);
  return Array.from(b).map((x)=>x.toString(16).padStart(2, '0')).join('');
}
async function deriveKeyIv(password) {
  const pk = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, [
    'deriveBits'
  ]);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-1',
    salt: SALT,
    iterations: 1000
  }, pk, 48 * 8);
  const all = new Uint8Array(bits);
  return {
    key: all.slice(0, 32),
    iv: all.slice(32, 48)
  };
}
async function aesEncrypt(plaintext, password) {
  const { key, iv } = await deriveKeyIv(password);
  const ck = await crypto.subtle.importKey('raw', key, {
    name: 'AES-CBC'
  }, false, [
    'encrypt'
  ]);
  const ct = await crypto.subtle.encrypt({
    name: 'AES-CBC',
    iv
  }, ck, utf16le(plaintext));
  return b64encode(ct);
}
async function aesDecrypt(b64, password) {
  const { key, iv } = await deriveKeyIv(password);
  const ck = await crypto.subtle.importKey('raw', key, {
    name: 'AES-CBC'
  }, false, [
    'decrypt'
  ]);
  const pt = await crypto.subtle.decrypt({
    name: 'AES-CBC',
    iv
  }, ck, b64decode(b64));
  return fromUtf16le(new Uint8Array(pt));
}
async function sha256hex(s) {
  return toHex(await crypto.subtle.digest('SHA-256', utf8(s)));
}
async function bncRequest(path, bodyObj, password, clientGuid, baseUrl = BNC_BASE) {
  const json = JSON.stringify(bodyObj);
  const Value = await aesEncrypt(json, password);
  const Validation = await sha256hex(json);
  const Reference = 'BTG' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
  const wrapper = {
    ClientGUID: clientGuid,
    Reference,
    Value,
    Validation,
    swTestOperation: false
  };
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(wrapper)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch  {
    data = {
      raw: text
    };
  }
  return {
    httpStatus: res.status,
    data
  };
}
function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  try {
    const body = await req.json().catch(()=>({}));
    const action = body.action || 'logon';
    const { data: cfg } = await supabase.from('bnc_config').select('*').order('updated_at', {
      ascending: false
    }).limit(1).maybeSingle();
    if (!cfg || !cfg.master_key || !cfg.client_guid) {
      return jsonResp({
        ok: false,
        error: 'Faltan credenciales BNC en bnc_config (master_key/client_guid)'
      });
    }
    const masterKey = cfg.master_key;
    const clientGuid = cfg.client_guid;
    const clientId = body.client_id || cfg.client_id || '';
    const baseUrl = cfg.base_url && String(cfg.base_url).trim() ? String(cfg.base_url).trim() : BNC_BASE;
    const logon = await bncRequest('/Auth/LogOn', {
      ClientGUID: clientGuid
    }, masterKey, clientGuid, baseUrl);
    const ld = logon.data || {};
    const lstatus = (ld.status || ld.Status || '').toString().toUpperCase();
    const lvalue = ld.value || ld.Value;
    if (logon.httpStatus >= 400 || lstatus && lstatus !== 'OK' || !lvalue) {
      return jsonResp({
        ok: false,
        step: 'logon',
        httpStatus: logon.httpStatus,
        respuesta: ld
      });
    }
    let workingKey = null;
    try {
      const parsed = JSON.parse(await aesDecrypt(lvalue, masterKey));
      workingKey = parsed.WorkingKey || parsed.workingKey || null;
    } catch (_e) {}
    if (!workingKey) return jsonResp({
      ok: false,
      step: 'logon-decrypt'
    });
    await supabase.from('bnc_config').update({
      working_key: workingKey,
      working_key_fecha: new Date().toISOString()
    }).eq('id', cfg.id);
    if (action === 'logon') {
      return jsonResp({
        ok: true,
        step: 'logon',
        message: ld.message || ld.Message,
        workingKeyMasked: '****' + workingKey.slice(-4)
      });
    }
    const consulta = async (path, reqBody)=>{
      const r = await bncRequest(path, reqBody, workingKey, clientGuid, baseUrl);
      const rd = r.data || {};
      const rvalue = rd.value || rd.Value;
      if (r.httpStatus >= 400 || !rvalue) return {
        ok: false,
        httpStatus: r.httpStatus,
        respuesta: rd
      };
      let parsed = null;
      try {
        parsed = JSON.parse(await aesDecrypt(rvalue, workingKey));
      } catch  {
        parsed = {
          raw: await aesDecrypt(rvalue, workingKey)
        };
      }
      return {
        ok: true,
        data: parsed
      };
    };
    if (action === 'tasas') {
      const r = await consulta('/Services/BCVRates', {});
      if (r.ok && r.data) {
        try {
          await supabase.from('configuracion').upsert([
            {
              clave: 'tasa_bnc',
              valor: JSON.stringify({
                ...r.data,
                hora: new Date().toISOString()
              })
            }
          ], {
            onConflict: 'clave'
          });
        } catch (_e) {}
      }
      return jsonResp({
        ok: r.ok,
        step: 'tasas',
        ...r
      });
    }
    if (action === 'saldo') {
      if (!clientId) return jsonResp({
        ok: false,
        step: 'saldo',
        error: 'Falta ClientID'
      });
      const r = await consulta('/Position/Current', {
        ClientID: clientId
      });
      return jsonResp({
        ok: r.ok,
        step: 'saldo',
        ...r.ok ? {
          saldos: r.data
        } : r
      });
    }
    if (action === 'movimientos') {
      if (!clientId || !body.account_number) return jsonResp({
        ok: false,
        step: 'movimientos',
        error: 'Falta client_id y/o account_number'
      });
      const r = await consulta('/Position/History', {
        ClientID: clientId,
        AccountNumber: body.account_number
      });
      return jsonResp({
        ok: r.ok,
        step: 'movimientos',
        ...r.ok ? {
          movimientos: r.data
        } : r
      });
    }
    if (action === 'movimientos_fecha') {
      if (!clientId || !body.account_number || !body.start_date || !body.end_date) return jsonResp({
        ok: false,
        step: 'movimientos_fecha',
        error: 'Falta client_id, account_number, start_date o end_date'
      });
      const r = await consulta('/Position/HistoryByDate', {
        ClientID: clientId,
        AccountNumber: body.account_number,
        StartDate: body.start_date,
        EndDate: body.end_date
      });
      return jsonResp({
        ok: r.ok,
        step: 'movimientos_fecha',
        ...r.ok ? {
          movimientos: r.data
        } : r
      });
    }
    if (action === 'resumen') {
      if (!clientId) return jsonResp({
        ok: false,
        step: 'resumen',
        error: 'Falta ClientID'
      });
      const sres = await consulta('/Position/Current', {
        ClientID: clientId
      });
      if (!sres.ok || !sres.data) return jsonResp({
        ok: false,
        step: 'resumen',
        error: 'No se pudo obtener saldo',
        detalle: sres
      });
      const saldos = sres.data;
      // Las cuentas cuyo saldo el BNC no nos deja ver. Se declaran en la base para que
      // agregar o quitar una no exija desplegar. Si la consulta falla, la lista queda
      // vacía y se muestra lo que diga el banco: nunca se oculta un saldo por un error
      // nuestro de lectura.
      const SIN_SALDO = new Set<string>();
      try {
        const cs = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/rest/v1/configuracion?clave=eq.bnc_cuentas_sin_saldo&select=valor`,
          { headers: { apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
                       Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` } });
        if (cs.ok) {
          const fila = (await cs.json())[0];
          const lista = JSON.parse(fila?.valor ?? "[]");
          if (Array.isArray(lista)) for (const x of lista) SIN_SALDO.add(String(x));
        }
      } catch (e) { console.error("bnc_cuentas_sin_saldo:", String(e)); }
      const vet = new Date(Date.now() - 4 * 3600 * 1000);
      const today = String(vet.getUTCDate()).padStart(2, '0') + '/' + String(vet.getUTCMonth() + 1).padStart(2, '0') + '/' + vet.getUTCFullYear();
      const cuentas = [];
      for (const acc of Object.keys(saldos)){
        // ⛔ UNA CUENTA QUE EL BANCO NO DEVOLVIÓ NO VALE CERO.
        //    04/11/2026: el tablero mostraba la cuenta en dólares …1897 en **$0,00** y Máximo
        //    mandó la pantalla del BNC: tiene **US$ 23.900,00** — seis compras desde el 24/08 y
        //    ni un solo débito, el saldo acumulado de su propia captura lo confirma. El sistema
        //    no tiene acceso a esa cuenta, así que el banco no manda su saldo… y este `|| 0`
        //    convertía «no pude leerla» en «tiene cero». Un cero AFIRMA; la falta de dato no.
        //    Ahora va `null` y la pantalla escribe «sin acceso».
        //    [[norma-falta-de-dato-no-es-un-dato]] [[norma-control-positivo-antes-de-creerle-al-vacio]]
        // ⛔ Y EL BANCO NO DEVUELVE «NADA»: DEVUELVE CERO. Medido el 04/11/2026 llamando a la
        //    función: para la cuenta en dólares …1897 el BNC manda `{"CurrencyCode":"USD",
        //    "Balance":0}` — y esa cuenta tiene **US$ 23.900,00** (la pantalla del portal del
        //    banco que mandó Máximo, seis compras desde el 24/08 sin un solo débito). O sea que
        //    el cero no se puede distinguir de un cero real mirando la respuesta: la cuenta
        //    …4881, en bolívares, SÍ está en cero de verdad.
        //    ⇒ Cuál cuenta no podemos leer es un HECHO DECLARADO, no algo que se adivine: vive
        //      en `configuracion.bnc_cuentas_sin_saldo`. Para esas no se escribe número.
        //      [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
        const crudoSaldo = saldos[acc] && (saldos[acc].Balance ?? saldos[acc].balance);
        const sinSaldo = SIN_SALDO.has(String(acc)) ||
          (crudoSaldo === undefined || crudoSaldo === null || crudoSaldo === '');
        const saldoActual = sinSaldo ? null : parseFloat(crudoSaldo);
        const moneda = saldos[acc] && (saldos[acc].CurrencyCode || saldos[acc].currencyCode) || 'VES';
        let ingresos = 0, egresos = 0, movsHoy = [];
        const mres = await consulta('/Position/History', {
          ClientID: clientId,
          AccountNumber: acc
        });
        if (mres.ok && Array.isArray(mres.data)) {
          movsHoy = mres.data.filter((m)=>String(m.Date || '').slice(0, 10) === today);
          for (const m of movsHoy){
            const amt = parseFloat(m.Amount || 0);
            const delta = String(m.BalanceDelta || '').toLowerCase();
            if (delta.includes('ingreso') || delta.includes('credito') || delta.includes('crÃ©dito')) ingresos += amt;
            else egresos += amt;
          }
        }
        const neto = ingresos - egresos;
        cuentas.push({
          cuenta: acc,
          moneda,
          // Sin saldo leído no hay saldo inicial que calcular: restarle el neto a un cero
          // inventado daría un número con aspecto de dato. Van los dos en null.
          saldoInicial: sinSaldo ? null : Math.round((saldoActual! - neto) * 100) / 100,
          ingresos: Math.round(ingresos * 100) / 100,
          egresos: Math.round(egresos * 100) / 100,
          neto: Math.round(neto * 100) / 100,
          saldoActual: sinSaldo ? null : Math.round(saldoActual! * 100) / 100,
          sinAcceso: sinSaldo,
          movimientosHoy: movsHoy.length,
          movimientos: movsHoy.map((m)=>({
              tipo: String(m.Type || '').trim(),
              monto: parseFloat(m.Amount || 0),
              signo: String(m.BalanceDelta || ''),
              concepto: String(m.Concept || '').trim(),
              ref: m.ReferenceA || '',
              hora: m.Date || ''
            }))
        });
      }
      return jsonResp({
        ok: true,
        step: 'resumen',
        fecha: today,
        esPrueba: clientId === 'J000121532',
        cuentas
      });
    }
    return jsonResp({
      ok: false,
      error: 'action no reconocida (logon | tasas | saldo | movimientos | movimientos_fecha | resumen)'
    });
  } catch (e) {
    return jsonResp({
      ok: false,
      error: String(e)
    }, 500);
  }
});