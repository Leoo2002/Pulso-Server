const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'auth-local-test-secret';
let googleError;
let profile;
let rpcResults;
let calls;
const googlePayload = {
  email: 'user@example.com', sub: 'google-user', name: 'Google Name',
  given_name: 'Google', picture: 'https://example.com/avatar',
  iat: 100, exp: 200, nbf: 100
};
const databasePath = require.resolve('../config/database');
const servicePath = require.resolve('../services/auth.service');
const originalDatabase = require.cache[databasePath];
const originalService = require.cache[servicePath];
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { supabase: { rpc: async (name, params) => {
    calls.push({ name, params });
    const result = rpcResults[name];
    if (result instanceof Error) throw result;
    if (result) return result;
    if (name === 'obtener_datos_usuario_nomina') return { data: profile, error: null };
    if (name === 'getrol') return { data: 'legacy-role', error: null };
    if (name === 'getrango') return { data: 5, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  } } }
};
require.cache[servicePath] = {
  id: servicePath, filename: servicePath, loaded: true,
  exports: { verifyGoogleToken: async () => {
    if (googleError) throw googleError;
    return { ...googlePayload };
  } }
};
const auth = require('./auth.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];
if (originalService) require.cache[servicePath] = originalService;
else delete require.cache[servicePath];

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/auth', auth);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  googleError = null;
  calls = [];
  rpcResults = {};
  profile = {
    datos: {
      id: 8, dni: '12345678', mail: googlePayload.email, lider: 'Leader',
      rango: 1, nombre: 'Nomina Name', usuario: 'U123456',
      segmento: ['ABONO', 'SOPORTE-RRSS'],
      herramientas: [{ nombre: 'KPI', id_herramienta: 6 }]
    },
    origen: 'nomina'
  };
});

function login(body = {}) {
  return fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'google-token', ...body })
  });
}

async function signedPayload(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=None/i);
  const decoded = jwt.verify(cookie.split(';')[0].slice('login-jwt='.length), process.env.JWT_SECRET);
  assert.deepEqual((await response.json()).payload, decoded);
  assert.equal(decoded.exp - decoded.iat, 8 * 60 * 60);
  return { decoded, cookie };
}

test('prioritizes nomina, preserves Google identity and returns the signed payload on reload', async () => {
  const { decoded, cookie } = await signedPayload(await login({
    email: 'forged@example.com', rango: 0, segmento: ['FORGED']
  }));
  for (const [field, value] of Object.entries(profile.datos)) assert.deepEqual(decoded[field], value);
  assert.equal(decoded.origen, 'nomina');
  assert.equal(decoded.rol, 'legacy-role');
  assert.equal(decoded.email, googlePayload.email);
  assert.equal(decoded.name, googlePayload.name);
  assert.equal(decoded.sub, googlePayload.sub);
  assert.equal(decoded.nbf, undefined);
  assert.equal(decoded.nomina, undefined);
  assert.deepEqual(calls, [
    { name: 'obtener_datos_usuario_nomina', params: { p_email: googlePayload.email } },
    { name: 'getrol', params: { mail: googlePayload.email } }
  ]);
  const reload = await fetch(`${base}/auth/recargar-storage`, {
    headers: { Cookie: cookie.split(';')[0] }
  });
  assert.equal(reload.status, 200);
  assert.deepEqual((await reload.json()).payload, decoded);
});

test('accepts a single row and range zero without querying either legacy RPC', async () => {
  profile.datos.rango = 0;
  profile.datos.rol = 'nomina-role';
  profile = [profile];
  const { decoded } = await signedPayload(await login());
  assert.equal(decoded.rango, 0);
  assert.equal(decoded.rol, 'nomina-role');
  assert.equal(calls.length, 1);
});

test('falls back only for missing values and preserves an explicitly empty segment list', async () => {
  profile.datos.rango = null;
  profile.datos.segmento = [];
  const { decoded } = await signedPayload(await login());
  assert.equal(decoded.rango, 5);
  assert.deepEqual(decoded.segmento, []);
  assert.equal(decoded.usuario, 'U123456');
  assert.equal(calls.filter(({ name }) => name === 'getrol').length, 1);
  assert.equal(calls.filter(({ name }) => name === 'getrango').length, 1);
});

test('uses the legacy segment when nomina omits it', async () => {
  delete profile.datos.segmento;
  const { decoded } = await signedPayload(await login());
  assert.equal(decoded.segmento, 'SOPORTE-RRSS');
});

for (const missing of [null, [], { datos: null, origen: 'nomina' }]) {
  test(`allows login without nomina: ${JSON.stringify(missing)}`, async () => {
    profile = missing;
    const { decoded } = await signedPayload(await login());
    assert.equal(decoded.nomina, null);
    assert.equal(decoded.rango, 5);
    assert.equal(decoded.rol, 'legacy-role');
    assert.equal(decoded.segmento, 'SOPORTE-RRSS');
  });
}

test('does not let nomina replace protected identity or expiration claims', async () => {
  Object.assign(profile.datos, { email: 'other@example.com', sub: 'other', name: 'Other', exp: 1 });
  const { decoded } = await signedPayload(await login());
  assert.equal(decoded.email, googlePayload.email);
  assert.equal(decoded.sub, googlePayload.sub);
  assert.equal(decoded.name, googlePayload.name);
});

for (const invalid of [
  'invalid', {}, { datos: [] }, [{ datos: {} }, { datos: {} }],
  { datos: { rango: '' } }, { datos: { rango: false } },
  { datos: { rango: 1.5 } }, { datos: { segmento: 'ABONO' } },
  { datos: { segmento: [123] } }, { datos: { herramientas: [{}] } }
]) {
  test(`rejects invalid nomina without issuing a cookie: ${JSON.stringify(invalid)}`, async () => {
    profile = invalid;
    const response = await login();
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(calls.length, 1);
  });
}

for (const name of ['obtener_datos_usuario_nomina', 'getrol', 'getrango']) {
  test(`reports ${name} RPC failure without issuing a cookie`, async () => {
    profile = null;
    rpcResults[name] = { data: null, error: { message: 'Database unavailable' } };
    const response = await login();
    assert.equal(response.status, 500);
    assert.ok((await response.json()).error);
    assert.equal(response.headers.get('set-cookie'), null);
  });
}

test('reports unexpected RPC rejection as a server error, not an invalid Google token', async () => {
  rpcResults.obtener_datos_usuario_nomina = new Error('RPC unavailable');
  const response = await login();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('rejects invalid Google tokens without querying nomina', async () => {
  googleError = new Error('Invalid Google token');
  const response = await login();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(calls, []);
});

test('special access always uses the fixed developer profile, ignoring requested range', async () => {
  process.env.U_SECRET = 'local-special-access';
  try {
    const response = await fetch(`${base}/auth/acceso-especial`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contra: 'local-special-access', rango: 0 })
    });

    const { decoded } = await signedPayload(response);
    assert.equal(decoded.email, 'leonel.quiroga@konecta.com');
    assert.equal(decoded.usuario, 'U936558');
    assert.equal(decoded.rango, 1);
    assert.equal(decoded.rol, 'DESARROLLADOR');
    assert.deepEqual(decoded.herramientas.map((tool) => tool.id_herramienta), [12, 10, 11]);
    assert.deepEqual(calls, []);
  } finally {
    delete process.env.U_SECRET;
  }
});

test('special access is unavailable without a configured password', async () => {
  const saved = process.env.U_SECRET;
  delete process.env.U_SECRET;
  try {
    const response = await fetch(`${base}/auth/acceso-especial`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
  } finally {
    if (saved !== undefined) process.env.U_SECRET = saved;
  }
});
