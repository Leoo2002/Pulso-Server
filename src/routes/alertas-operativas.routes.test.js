const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const databasePath = require.resolve('../config/database');
const originalDatabase = require.cache[databasePath];
let rpcResult;
let calls = [];
let tools = [];
let uploadedFiles = [];
let removedFiles = [];
let storageRemoveError = null;
const storage = {
  from: () => ({
    upload: async (filePath, buffer, options) => {
      uploadedFiles.push({ filePath, size: buffer.length, options });
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
      rango: Number(req.headers['x-test-range'] ?? 5)
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
  assert.equal(calls.length, 1);
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
    servicios: ['DEGRA', 'VENTAS', 'ONBOARDING'],
    imagen_url: 'alertas-operativas/abono-degra/unique-id.png',
    fecha_creacion: '2026-10-27T12:00:00Z'
  }, error: null };
  uploadedFiles = [];
  removedFiles = [];
  const response = await post({
    servicio: 'ABONO/DEGRA',
    servicios: ['DEGRA', 'VENTAS', 'ONBOARDING'],
    titulo_aviso: ' Mantenimiento ',
    tipo_severidad: 'Alta',
    comentario: ' Se interrumpirá el servicio '
  }, 5, { name: 'aviso.png', type: 'image/png', contents: 'fake-image' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ...rpcResult.data,
    imagen_url: `https://signed.example/${uploadedFiles[0].filePath}?expires=3600`
  });
  assert.equal(uploadedFiles.length, 1);
  assert.equal(uploadedFiles[0].size, 'fake-image'.length);
  assert.equal(uploadedFiles[0].options.contentType, 'image/png');
  assert.match(uploadedFiles[0].filePath, /^alertas-operativas\/degra\/.+\.png$/);
  assert.deepEqual(calls.at(-1), {
    name: 'crear_alerta_operativa_multi',
    params: {
      p_titulo_aviso: 'Mantenimiento',
      p_tipo_severidad: 'Alta',
      p_comentario: 'Se interrumpirá el servicio',
      p_servicios: ['DEGRA', 'VENTAS', 'ONBOARDING'],
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
  assert.equal(calls.length, 1);
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

test('requires permission for every destination ticketera', async () => {
  tools = [{ nombre: 'TICKETERA_ABONO_DEGRA' }];
  calls = [];
  const response = await post({
    servicio: 'DEGRA',
    servicios: ['DEGRA', 'VENTAS'],
    titulo_aviso: 'Aviso',
    tipo_severidad: 'Alta',
    comentario: 'Detalle'
  });
  assert.equal(response.status, 403);
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

test('deletes an alert through the public RPC and removes its stored image', async () => {
  tools = [{ nombre: 'TICKETERA_ONBOARDING' }];
  const alert = {
    id: 21,
    titulo_aviso: 'Aviso a eliminar',
    tipo_severidad: 'Alta',
    comentario: 'Detalle',
    servicio: 'ONBOARDING',
    servicios: ['ONBOARDING', 'VENTAS'],
    imagen_url: 'alertas-operativas/onboarding/image.png',
    fecha_creacion: '2026-10-27T12:00:00Z'
  };
  rpcResult = {
    data: { estado: 'ok', mensaje: 'Alerta eliminada correctamente.', alerta: alert },
    error: null
  };
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
  const response = await removeAlert(21);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'No existe una alerta con ese ID.' });
});
