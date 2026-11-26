import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const appHtml = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

function extractFn(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `No se encontró la función ${name}`);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  let inStr = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '/' && src[j + 1] === '/') { while (j < src.length && src[j] !== '\n') j++; continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  throw new Error(`No se cerró la función ${name}`);
}

test('1. _nuevoIdEmpleado genera ID único sin colisionar con existentes', () => {
  const fnCode = extractFn(appJs, '_nuevoIdEmpleado');
  const ctx = { EMPLEADOS: [{ id: 'E001' }, { id: 'E022' }, { id: 'E988' }, { id: 'EX21A' }] };
  vm.runInNewContext(fnCode + '; this.fn = _nuevoIdEmpleado;', ctx);
  assert.equal(ctx.fn(), 'E989');
  assert.equal(ctx.fn({ E989: 1, E990: 1 }), 'E991');
});

test('2. _firmarFotos firma en lote tanto bucket asistencia como bucket entregas', async () => {
  const code = [
    extractFn(appJs, '_rutaDeUrl'),
    extractFn(appJs, '_rutasAProbar'),
    extractFn(appJs, '_bucketDeUrl'),
    extractFn(appJs, '_firmarFotos'),
  ].join('\n');

  const llamadas = [];
  const ctx = {
    DB_READY: true,
    console,
    supabase: {
      storage: {
        from(bucket) {
          return {
            async createSignedUrls(rutas, ttl) {
              llamadas.push({ bucket, rutas: [...rutas], ttl });
              return {
                data: rutas.map(r => ({ signedUrl: `https://signed.test/storage/v1/object/sign/${bucket}/${r}?token=OK` })),
                error: null,
              };
            },
          };
        },
      },
    },
  };
  vm.runInNewContext(code + '; this.firmar = _firmarFotos;', ctx);

  const emps = [
    { id: 'E001', foto: 'https://hrkjddehqnzcqwlkklqm.supabase.co/storage/v1/object/public/entregas/empleados/E001-abc.jpg' },
    { id: 'E111', foto: 'empleados/2026/09/E111-xyz.jpg' },
    { id: 'E836', foto: 'https://hrkjddehqnzcqwlkklqm.supabase.co/storage/v1/object/sign/asistencia/empleados/2026/08/E836-old.jpg?token=EXPIRED' },
    { id: 'E988', foto: '' },
  ];
  await ctx.firmar(emps, 'foto', 'asistencia');

  const bucketsFirmados = llamadas.map(l => l.bucket).sort();
  assert.deepEqual(bucketsFirmados, ['asistencia', 'entregas']);
  assert.match(emps[0].foto, /\/object\/sign\/entregas\/empleados\/E001-abc\.jpg\?token=OK/);
  assert.match(emps[1].foto, /\/object\/sign\/asistencia\/empleados\/2026\/09\/E111-xyz\.jpg\?token=OK/);
  assert.match(emps[2].foto, /\/object\/sign\/asistencia\/empleados\/2026\/08\/E836-old\.jpg\?token=OK/);
  assert.equal(emps[3].foto, '');
});

test('3. _rutaFoto nunca persiste tokens firmados y preserva el bucket entregas', () => {
  const code = [
    extractFn(appJs, '_rutaDeUrl'),
    extractFn(appJs, '_bucketDeUrl'),
    extractFn(appJs, '_rutaFoto'),
  ].join('\n');
  const ctx = { SUPA_URL: 'https://hrkjddehqnzcqwlkklqm.supabase.co' };
  vm.runInNewContext(code + '; this.rutaFoto = _rutaFoto;', ctx);

  assert.equal(
    ctx.rutaFoto('https://hrkjddehqnzcqwlkklqm.supabase.co/storage/v1/object/sign/asistencia/empleados/2026/08/E836.jpg?token=SECRET'),
    'empleados/2026/08/E836.jpg'
  );
  assert.equal(
    ctx.rutaFoto('https://hrkjddehqnzcqwlkklqm.supabase.co/storage/v1/object/sign/entregas/empleados/E022-w6afuccd.jpg?token=SECRET'),
    'https://hrkjddehqnzcqwlkklqm.supabase.co/storage/v1/object/public/entregas/empleados/E022-w6afuccd.jpg'
  );
  assert.equal(ctx.rutaFoto('empleados/2026/09/E111.jpg'), 'empleados/2026/09/E111.jpg');
  assert.equal(ctx.rutaFoto(''), '');
});

test('4. guardarEmpleado usa insert en alta, update en edición, y bloquea colisión de ID', () => {
  const fn = extractFn(appJs, 'guardarEmpleado');
  assert.ok(!fn.includes(".from('empleados').upsert("), 'guardarEmpleado no debe usar upsert (puede pisar otra ficha)');
  assert.ok(fn.includes(".from('empleados').insert("), 'guardarEmpleado debe usar insert en altas nuevas');
  assert.ok(fn.includes(".from('empleados').update("), 'guardarEmpleado debe usar update en ediciones');
  assert.ok(fn.includes('yaExiste'), 'guardarEmpleado debe validar colisión de ID manual');
  assert.ok(fn.includes('_nuevoIdEmpleado()'), 'guardarEmpleado debe generar ID con _nuevoIdEmpleado()');
  assert.ok(fn.includes("String(resEmp.error.code||'')") && fn.includes("'23505'"), 'guardarEmpleado debe capturar duplicado 23505');
});

test('5. cargarDatosDB y cargarDatosMinimos cargan formaPago/sueldo y firman fotos', () => {
  const minFn = extractFn(appJs, 'cargarDatosMinimos');
  const dbFn = extractFn(appJs, 'cargarDatosDB');
  assert.ok(minFn.includes('formaPago:x.forma_pago'), 'cargarDatosMinimos debe mapear formaPago');
  assert.ok(minFn.includes('_firmarFotos(EMPLEADOS'), 'cargarDatosMinimos debe firmar fotos de empleados');
  assert.ok(dbFn.includes('formaPago:x.forma_pago'), 'cargarDatosDB debe mapear formaPago');
  assert.ok(dbFn.includes('sueldo:parseFloat(x.sueldo)'), 'cargarDatosDB debe mapear sueldo');
  assert.ok(dbFn.includes('_firmarFotos(EMPLEADOS'), 'cargarDatosDB debe firmar fotos de empleados');
});

test('6. guardarImportacionEnDB y reactivarEmpleadoNomina no pisan foto_url ni expediente completo', () => {
  const impFn = extractFn(appJs, 'guardarImportacionEnDB');
  const reacFn = extractFn(appJs, 'reactivarEmpleadoNomina');
  assert.ok(impFn.includes(".from('empleados').update({"), 'personalSync debe hacer update parcial para empleados existentes');
  assert.ok(!impFn.includes('foto_url:e.foto||'), 'personalSync no debe guardar e.foto sin _rutaFoto');
  assert.ok(reacFn.includes(".from('empleados').update({activo:true}).eq('id',e.id)"), 'reactivarEmpleadoNomina debe hacer update mínimo {activo:true}');
  assert.ok(!reacFn.includes(".from('empleados').upsert("), 'reactivarEmpleadoNomina no debe hacer upsert completo');
});

test('7. _procesarEmpleadosExcel conserva datos existentes ante celdas vacías y re-firma fotos', () => {
  const xlFn = extractFn(appJs, '_procesarEmpleadosExcel');
  assert.ok(xlFn.includes('_nuevoIdEmpleado('), '_procesarEmpleadosExcel debe usar _nuevoIdEmpleado');
  assert.ok(xlFn.includes("ced||(ex?ex.cedula:'')"), '_procesarEmpleadosExcel debe conservar cedula si viene vacía');
  assert.ok(xlFn.includes("gv2(r,'banco')||(ex?ex.banco:'')"), '_procesarEmpleadosExcel debe conservar banco si viene vacío');
  assert.ok(xlFn.includes('await _firmarFotos(EMPLEADOS'), '_procesarEmpleadosExcel debe re-firmar fotos tras recargar');
});

test('8. app.html tiene cache-buster actualizado conservando compatibilidad', () => {
  assert.match(appHtml, /app\.js\?v=20261125-ciclo-pago-a-pago-expedientes-20261126/);
});
