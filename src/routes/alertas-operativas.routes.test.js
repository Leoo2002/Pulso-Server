const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');

const databasePath = require.resolve('../config/database');
const originalDatabase = require.cache[databasePath];
let rpcResult;
let calls = [];
let tools = [];
let uploadedFiles = [];
let removedFiles = [];
let storageRemoveError = null;
let deletionScope;
let deletionScopeError = null;
beforeEach(() => {
  deletionScope = undefined;
  deletionScopeError = null;
});
const storage = {
  from: () => ({
    upload: async (filePath, buffer, options) => {
      uploadedFiles.push({ filePath, buffer, size: buffer.length, options });
      return { error: null };
    },
    createSignedUrl: async (filePath, expiresIn) => ({
      data: { signedUrl: `https://signed.example/${filePath}?expires=${expiresIn}` },
      error: null
    }),
    remove: async (paths) => {
      removedFiles.push(...paths);
      return { error: storageRemoveError };
    }
  })
};
const rpc = async (name, params) => {
  calls.push({ name, params });
  if (name === 'obtener_herramientas_usuario') return { data: tools, error: null };
  if (name === 'obtener_alertas_operativas' && deletionScope !== undefined) {
    return { data: deletionScope, error: deletionScopeError };
  }
  return rpcResult;
};
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    supabase: {
      rpc,
      schema: (name) => ({
        rpc: async (functionName, params) => {
          calls.push({ schema: name, name: functionName, params });
          return rpcResult;
        }
      }),
      storage
    }
  }
};
const router = require('./alertas-operativas.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      email: 'gestor@example.com',
      rango: Number(req.headers['x-test-range'] ?? 5),
      herramientas: tools.map((tool) => ({
        ...tool, id_herramienta: {
          TICKETERA_ONBOARDING: 10, TICKETERA_VENTAS: 11, TICKETERA_ABONO_DEGRA: 12
        }[tool.nombre]
      }))
    };
    next();
  });
  app.use(router);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function get(service = 'VENTAS') {
  return fetch(`${base}/alertas-operativas?servicio=${encodeURIComponent(service)}`);
}

async function post(body, range = 5, image = null) {
  const form = new FormData();
  for (const [field, value] of Object.entries(body)) {
    form.append(field, Array.isArray(value) ? JSON.stringify(value) : value);
  }
  if (image) form.append('imagen', new Blob([image.contents], { type: image.type }), image.name);
  return fetch(`${base}/alertas-operativas?servicio=${encodeURIComponent(body.servicio || 'VENTAS')}`, {
    method: 'POST',
    headers: { 'x-test-range': String(range) },
    body: form
  });
}

async function removeAlert(id, service = 'VENTAS', range = 5) {
  return fetch(`${base}/alertas-operativas/${encodeURIComponent(String(id))}?servicio=${encodeURIComponent(service)}`, {
    method: 'DELETE',
    headers: { 'x-test-range': String(range) }
  });
}

test('lists alerts for the selected service through the provided RPC', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  const alerts = [{
    id: 1,
    titulo_aviso: 'Aviso',
    tipo_severidad: 'Alta',
    comentario: 'Detalle',
    servicio: 'VENTAS',
    imagen_url: 'alertas-operativas/ventas/aviso.png',
    fecha_creacion: '2026-10-27T12:00:00Z'
  }];
  uploadedFiles = [];
  removedFiles = [];
  rpcResult = { data: alerts, error: null };
  calls = [];
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{
    ...alerts[0],
    imagen_url: 'https://signed.example/alertas-operativas/ventas/aviso.png?expires=3600'
  }]);
  assert.deepEqual(calls.at(-1), {
    name: 'obtener_alertas_operativas',
    params: { p_servicio: 'VENTAS', p_tipo_severidad: null }
  });
  assert.equal(uploadedFiles.length, 0);
});

test('requires permission for the selected ticketera before accessing alerts', async () => {
  tools = [{ nombre: 'TICKETERA_ABONO_DEGRA' }];
  calls = [];
  assert.equal((await get('VENTAS')).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await get('OTRO')).status, 400);
});

test('lists Onboarding alerts with the database service name', async () => {
  tools = [{ nombre: 'TICKETERA_ONBOARDING' }];
  rpcResult = { data: [], error: null };
  calls = [];
  assert.equal((await get('ONBOARDING')).status, 200);
  assert.deepEqual(calls.at(-1), {
    name: 'obtener_alertas_operativas',
    params: { p_servicio: 'ONBOARDING', p_tipo_severidad: null }
  });
});

test('creates a validated alert only for management profiles', async () => {
  tools = [
    { nombre: 'TICKETERA_ABONO_DEGRA' },
    { nombre: 'TICKETERA_VENTAS' },
    { nombre: 'TICKETERA_ONBOARDING' }
  ];
  rpcResult = { data: {
    id: 9,
    titulo_aviso: 'Mantenimiento',
    tipo_severidad: 'Alta',
    comentario: 'Se interrumpirá el servicio',
    servicio: 'DEGRA',
    servicios: ['DEGRA'],
    imagen_url: 'alertas-operativas/abono-degra/unique-id.png',
    fecha_creacion: '2026-10-27T12:00:00Z'
  }, error: null };
  uploadedFiles = [];
  removedFiles = [];
  const image = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#8060c0' }
  }).png().toBuffer();
  const response = await post({
    servicio: 'ABONO/DEGRA',
    servicios: ['DEGRA'],
    titulo_aviso: ' Mantenimiento ',
    tipo_severidad: 'Alta',
    comentario: ' Se interrumpirá el servicio '
  }, 5, { name: 'aviso.png', type: 'image/png', contents: image });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ...rpcResult.data,
    imagen_url: `https://signed.example/${uploadedFiles[0].filePath}?expires=3600`
  });

  assert.equal(uploadedFiles.length, 1);
  assert.ok(uploadedFiles[0].size < image.length);
  assert.equal(uploadedFiles[0].options.contentType, 'image/webp');
  assert.equal((await sharp(uploadedFiles[0].buffer).metadata()).width, 1920);
  assert.match(uploadedFiles[0].filePath, /^alertas-operativas\/degra\/.+\.webp$/);
  assert.deepEqual(calls.at(-1), {
    name: 'crear_alerta_operativa_multi',
    params: {
      p_titulo_aviso: 'Mantenimiento',
      p_tipo_severidad: 'Alta',
      p_comentario: 'Se interrumpirá el servicio',
      p_servicios: ['DEGRA'],
      p_imagen_url: uploadedFiles[0].filePath
    }
  });
  assert.deepEqual(removedFiles, []);

  calls = [];
  assert.equal((await post({
    servicio: 'ABONO/DEGRA',
    servicios: ['DEGRA'],
    titulo_aviso: 'Aviso',
    tipo_severidad: 'Alta',
    comentario: 'Detalle'
  }, 0)).status, 403);
  assert.equal(calls.length, 0);
});

test('leaders, chiefs and managers can create alerts only in assigned ticketera', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  rpcResult = { data: {
    id: 9, titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle',
    servicio: 'VENTAS', servicios: ['VENTAS'], imagen_url: null, fecha_creacion: '2026-10-29T12:00:00Z'
  }, error: null };
  for (const range of [1, 2, 3, 4, 5]) {
    assert.equal((await post({
      servicio: 'VENTAS', titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle'
    }, range)).status, 201);
    assert.equal((await post({
      servicio: 'ONBOARDING', titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle'
    }, range)).status, 403);
  }
});

test('does not expose alerts returned outside the selected service', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  rpcResult = { data: [{
    id: 9, titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle',
    servicio: 'ONBOARDING', imagen_url: null, fecha_creacion: '2026-10-29T12:00:00Z'
  }], error: null };
  assert.equal((await get('VENTAS')).status, 502);
});

test('rejects invalid alert input without calling the create RPC', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  for (const body of [
    { servicio: 'VENTAS', servicios: ['VENTAS'], titulo_aviso: '', tipo_severidad: 'Alta', comentario: 'Detalle' },
    { servicio: 'VENTAS', servicios: ['OTRO'], titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle' },
    { servicio: 'VENTAS', servicios: [], titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle' }
  ]) {
    calls = [];
    assert.equal((await post(body)).status, 400);
    assert.equal(calls.some((call) => call.name === 'crear_alerta_operativa'), false);
  }
});

test('rejects publishing to any destination other than the active ticketera', async () => {
  tools = [{ nombre: 'TICKETERA_ABONO_DEGRA' }];
  calls = [];
  const response = await post({
    servicio: 'DEGRA',
    servicios: ['DEGRA', 'VENTAS'],
    titulo_aviso: 'Aviso',
    tipo_severidad: 'Alta',
    comentario: 'Detalle'
  });
  assert.equal(response.status, 400);
  assert.equal(calls.some((call) => call.name === 'crear_alerta_operativa_multi'), false);
});

test('surfaces RPC and malformed response failures', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  rpcResult = { data: null, error: { message: 'RPC no disponible' } };
  assert.equal((await get()).status, 500);
  rpcResult = { data: null, error: null };
  assert.equal((await post({
    servicio: 'VENTAS',
    servicios: ['VENTAS'],
    titulo_aviso: 'Aviso',
    tipo_severidad: 'Alta',
    comentario: 'Detalle'
  })).status, 502);
});

test('rejects unsupported image types before upload', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  uploadedFiles = [];
  const response = await post({
    servicio: 'VENTAS',
    servicios: ['VENTAS'],
    titulo_aviso: 'Aviso',
    tipo_severidad: 'Alta',
    comentario: 'Detalle'
  }, 5, { name: 'script.svg', type: 'image/svg+xml', contents: '<svg/>' });
  assert.equal(response.status, 400);
  assert.equal(uploadedFiles.length, 0);
});

test('rejects corrupted images without storing a file or creating the alert', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  calls = [];
  uploadedFiles = [];
  const response = await post({
    servicio: 'VENTAS', servicios: ['VENTAS'],
    titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle'
  }, 5, { name: 'aviso.png', type: 'image/png', contents: 'fake-image' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /No se pudo leer la imagen/);
  assert.equal(uploadedFiles.length, 0);
  assert.equal(calls.some(({ name }) => name === 'crear_alerta_operativa_multi'), false);
});

test('cleans up the optimized image if the create RPC fails', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  uploadedFiles = [];
  removedFiles = [];
  rpcResult = { data: null, error: { message: 'Creation failed' } };
  const image = await sharp({
    create: { width: 100, height: 100, channels: 3, background: 'white' }
  }).png().toBuffer();
  const response = await post({
    servicio: 'VENTAS', servicios: ['VENTAS'],
    titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle'
  }, 5, { name: 'aviso.png', type: 'image/png', contents: image });
  assert.equal(response.status, 500);
  assert.equal(uploadedFiles.length, 1);
  assert.deepEqual(removedFiles, [uploadedFiles[0].filePath]);
});

test('deletes an alert through the public RPC and removes its stored image', async () => {
  tools = [{ nombre: 'TICKETERA_ONBOARDING' }];
  const alert = {
    id: 21,
    titulo_aviso: 'Aviso a eliminar',
    tipo_severidad: 'Alta',
    comentario: 'Detalle',
    servicio: 'ONBOARDING',
    servicios: ['ONBOARDING'],
    imagen_url: 'alertas-operativas/onboarding/image.png',
    fecha_creacion: '2026-10-27T12:00:00Z'
  };
  rpcResult = {
    data: { estado: 'ok', mensaje: 'Alerta eliminada correctamente.', alerta: alert },
    error: null
  };
  deletionScope = [alert];
  calls = [];
  removedFiles = [];
  storageRemoveError = null;

  const response = await removeAlert(21, 'ONBOARDING');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    estado: 'ok',
    mensaje: 'Alerta eliminada correctamente.',
    alerta: alert
  });
  assert.deepEqual(calls.at(-1), {
    name: 'eliminar_alerta_operativa',
    params: { p_id: 21 }
  });
  assert.deepEqual(removedFiles, [alert.imagen_url]);
});

test('deletion validates alert ID, service access and management profile', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  calls = [];
  assert.equal((await removeAlert('invalid')).status, 400);
  assert.equal((await removeAlert(21, 'ONBOARDING')).status, 403);
  assert.equal((await removeAlert(21, 'VENTAS', 0)).status, 403);
  assert.equal(calls.some((call) => call.name === 'eliminar_alerta_operativa'), false);
});

test('returns not found when the delete function reports a missing alert', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  rpcResult = { data: null, error: { message: 'No existe una alerta con ID 21.' } };
  deletionScope = [];
  const response = await removeAlert(21);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'No existe una alerta con ese ID en la ticketera activa.' });
});

test('allows every non-agent range to delete within its authorized active ticketera', async () => {
  const alert = {
    id: 21, titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle',
    servicio: 'VENTAS', imagen_url: null, fecha_creacion: '2026-10-27T12:00:00Z'
  };
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  deletionScope = [alert];
  rpcResult = { data: { estado: 'ok', alerta: alert }, error: null };
  for (const range of [1, 2, 3, 4, 5]) {
    assert.equal((await removeAlert(21, 'VENTAS', range)).status, 200);
  }
  assert.equal((await removeAlert(21, 'VENTAS', 0)).status, 403);
  assert.equal((await removeAlert(21, 'VENTAS', 6)).status, 403);
});

test('never deletes a foreign ID, even when the caller can access both ticketeras', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }, { nombre: 'TICKETERA_ONBOARDING' }];
  deletionScope = [{
    id: 21, titulo_aviso: 'Otra operación', tipo_severidad: 'Alta', comentario: 'Detalle',
    servicio: 'ONBOARDING', imagen_url: null, fecha_creacion: '2026-10-27T12:00:00Z'
  }];
  calls = [];
  assert.equal((await removeAlert(21, 'VENTAS')).status, 403);
  deletionScope = [];
  assert.equal((await removeAlert(21, 'VENTAS')).status, 404);
  assert.equal(calls.some(({ name }) => name === 'eliminar_alerta_operativa'), false);
});

test('fails closed on scope lookup errors and legacy alerts shared with inaccessible ticketeras', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  deletionScope = [{
    id: 21, titulo_aviso: 'Compartida', tipo_severidad: 'Alta', comentario: 'Detalle',
    servicio: 'VENTAS', servicios: ['VENTAS', 'ONBOARDING'],
    imagen_url: null, fecha_creacion: '2026-10-27T12:00:00Z'
  }];
  calls = [];
  assert.equal((await removeAlert(21)).status, 403);
  deletionScopeError = new Error('Scope unavailable');
  assert.equal((await removeAlert(21)).status, 500);
  deletionScopeError = null;
  deletionScope = null;
  assert.equal((await removeAlert(21)).status, 502);
  assert.equal(calls.some(({ name }) => name === 'eliminar_alerta_operativa'), false);
});

test('derives the publication destination when omitted and rejects multi-service input even for admins', async () => {
  tools = [{ nombre: 'TICKETERA_VENTAS' }];
  const alert = {
    id: 21, titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle',
    servicio: 'VENTAS', imagen_url: null, fecha_creacion: '2026-10-27T12:00:00Z'
  };
  rpcResult = { data: alert, error: null };
  calls = [];
  const body = { servicio: 'VENTAS', titulo_aviso: 'Aviso', tipo_severidad: 'Alta', comentario: 'Detalle' };
  assert.equal((await post(body)).status, 201);
  assert.deepEqual(calls.at(-1).params.p_servicios, ['VENTAS']);
  calls = [];
  assert.equal((await post({ ...body, servicios: ['VENTAS', 'ONBOARDING'] }, 1)).status, 400);
  assert.equal((await post({ ...body, servicios: ['ONBOARDING'] }, 1)).status, 400);
  assert.equal(calls.some(({ name }) => name === 'crear_alerta_operativa_multi'), false);
});
