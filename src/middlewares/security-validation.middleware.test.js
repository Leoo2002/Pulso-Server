const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'security-logging-test-secret';
const databasePath = require.resolve('../config/database');
const servicePath = require.resolve('../services/auth.service');
const originalDatabase = require.cache[databasePath];
const originalService = require.cache[servicePath];
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { supabase: {} }
};
require.cache[servicePath] = {
  id: servicePath, filename: servicePath, loaded: true,
  exports: { verifyGoogleToken: async () => ({}) }
};
const authRoutes = require('../routes/auth.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];
if (originalService) require.cache[servicePath] = originalService;
else delete require.cache[servicePath];

const jwtValidation = require('./jwt-validation');
const authMiddleware = require('./auth');
const { logSecurityEvents } = require('./security-validation.middleware');

let server;
let base;
before(async () => {
  const app = express();
  app.use(cookieParser(), express.json(), logSecurityEvents);
  app.use('/api', jwtValidation);
  app.use('/auth/recargar-storage', jwtValidation);
  app.use('/auth/validar-acceso', jwtValidation);
  app.use('/auth', authRoutes);
  app.get('/api/protected', (req, res) => res.json({ ok: true }));
  app.get('/role', authMiddleware([1]), (req, res) => res.json({ ok: true }));
  app.get('/generic', (req, res) => res.status(401).json({ error: 'Error al crear el token' }));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function request(path, token) {
  const messages = [];
  const original = {};
  for (const method of ['log', 'info', 'warn', 'error']) {
    original[method] = console[method];
    console[method] = (...args) => messages.push({ method, text: args.join(' ') });
  }
  try {
    const response = await fetch(`${base}${path}`, {
      headers: token ? { Cookie: `login-jwt=${token}` } : {}
    });
    return { status: response.status, body: await response.json(), messages };
  } finally {
    for (const method of Object.keys(original)) console[method] = original[method];
  }
}

function event(result) {
  const events = result.messages.filter(({ text }) => text.includes('EVENTO DE SEGURIDAD DETECTADO'));
  assert.equal(events.length, 1);
  return events[0].text;
}

test('session recovery without a cookie is informational and returns 401', async () => {
  const result = await request('/auth/recargar-storage?example=secret');
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: 'Token no brindado' });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].method, 'info');
  assert.match(result.messages[0].text, /GET \/auth\/recargar-storage \(401, token_missing\)/);
  assert.doesNotMatch(result.messages[0].text, /secret|ATAQUE|TOKEN_EXPIRED/);
});

for (const [label, token, type] of [
  ['expired', jwt.sign({ sub: 'user' }, process.env.JWT_SECRET, { expiresIn: -10 }), 'TOKEN_EXPIRED'],
  ['invalid', 'not-a-jwt', 'TOKEN_INVALID']
]) {
  test(`session recovery classifies an ${label} token and returns 401`, async () => {
    const result = await request('/auth/recargar-storage?example=secret', token);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Token no válido' });
    const log = event(result);
    assert.match(log, new RegExp(`Tipo: ${type} `));
    assert.match(log, /Ruta: \/auth\/recargar-storage\b/);
  });

  test(`global JWT middleware classifies an ${label} token`, async () => {
    const result = await request('/api/protected', token);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Token no válido' });
    assert.match(event(result), new RegExp(`Tipo: ${type} `));
  });

  test(`role middleware classifies an ${label} token`, async () => {
    const result = await request('/role', token);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Token inválido o expirado' });
    assert.match(event(result), new RegExp(`Tipo: ${type} `));
  });
}

test('missing tokens on other protected routes remain security events', async () => {
  for (const [path, status, message] of [
    ['/api/protected', 401, 'Token no brindado'],
    ['/role', 401, 'No autorizado: token faltante']
  ]) {
    const result = await request(path);
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { error: message });
    assert.match(event(result), /Tipo: TOKEN_MISSING /);
  }
});

test('JWT validation cannot be bypassed through mounted root or public-looking paths', async () => {
  for (const path of ['/api/', '/api/auth/login', '/api/logok/inicio', '/auth/validar-acceso?view=inicio']) {
    const result = await request(path);
    assert.equal(result.status, 401, path);
    assert.deepEqual(result.body, { error: 'Token no brindado' });
    assert.match(event(result), /Tipo: TOKEN_MISSING /);
  }
});

test('valid tokens without the required role still receive 403', async () => {
  const token = jwt.sign({ sub: 'user', rango: 2 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const result = await request('/role', token);
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: 'Acceso denegado: permiso insuficiente' });
});

test('generic token errors are not assumed to be expired', async () => {
  const result = await request('/generic');
  assert.equal(result.status, 401);
  assert.match(event(result), /Tipo: TOKEN_ERROR /);
});

test('a valid cookie still restores the session and grants protected access', async () => {
  const token = jwt.sign({ sub: 'user', rango: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  for (const path of ['/auth/recargar-storage', '/api/protected', '/role']) {
    const result = await request(path, token);
    assert.equal(result.status, 200);
    assert.ok(!result.messages.some(({ text }) => text.includes('EVENTO DE SEGURIDAD DETECTADO')));
  }
});
