const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'ticketera-local-test-secret';
const databasePath = require.resolve('../config/database');
const originalDatabase = require.cache[databasePath];
let tools;
let toolsError;
let calls;
let caseType;
let caseError;
let createResult;
let createError;
const query = {
  select() { return this; },
  eq() { return this; },
  maybeSingle: async () => ({ data: caseType ? { tipo_ticketera: caseType } : null, error: caseError })
};
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { supabase: {
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (name === 'obtener_herramientas_usuario') return { data: tools, error: toolsError };
      if (name === 'crear_ticket_ticketera') return { data: createResult, error: createError };
      if (name === 'actualizar_estado_ticketera') return { data: createResult, error: createError };
      if (name === 'obtener_tickets') return { data: [], error: null };
      throw new Error(`Unexpected business RPC: ${name}`);
    },
    schema: () => ({ from: () => query })
  } }
};
const { requireTicketeraAccess, sendTicketeraAccess, normalizeTicketera } = require('./ticketera-access');
const tickets = require('../routes/tickets.routes');
const ticketera = require('../routes/ticketera.routes');
const degra = require('../routes/degra-ticketera.routes');
const analytics = require('../routes/ticketera-analytics.routes');
const alerts = require('../routes/alertas-operativas.routes');
const auth = require('../routes/auth.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use((req, res, next) => {
    try {
      req.user = jwt.verify(req.cookies['login-jwt'], process.env.JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'Sesion invalida.' });
    }
  });
  app.get('/ticketera/acceso', requireTicketeraAccess(), sendTicketeraAccess);
  app.get('/unrelated', (_req, res) => res.json({ ok: true }));
  app.get('/allowed/:ticketera', (req, res, next) =>
    requireTicketeraAccess(req.params.ticketera)(req, res, next), (_req, res) => res.json({ ok: true }));
  app.use('/auth', auth);
  app.use(tickets, analytics, alerts, ticketera, degra);
  // Detect accidental router-wide authorization on unrelated routes.
  app.get('/historico-test', (_req, res) => res.json({ ok: true }));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  tools = [];
  toolsError = null;
  calls = [];
  caseType = 'ONBOARDING';
  caseError = null;
  createResult = { ok: true, caso_id: 23, id_tck: 'ONB-23', tipo_reg: 'ITRACKER', tipo_ticketera: 3 };
  createError = null;
});

test('maps numeric service IDs to ticketera access names', () => {
  assert.equal(normalizeTicketera(2), 'VENTAS');
  assert.equal(normalizeTicketera(3), 'ONBOARDING');
  assert.equal(normalizeTicketera(4), 'DEGRA');
  assert.equal(normalizeTicketera('3'), 'ONBOARDING');
});

test('creates an IT case through the shared RPC with the authenticated creator email', async () => {
  tools = [{ id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' }];
  const response = await request('/crearTicketera', {
    method: 'POST',
    body: {
      servicio: 'IT',
      ticket: {
        email: 'forged@example.com',
        tipo: 'eTracker',
        motivo: 'App',
        numero_gestion: 'IT-123'
      }
    }
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), createResult);
  assert.deepEqual(calls.find(({ name }) => name === 'crear_ticket_ticketera'), {
    name: 'crear_ticket_ticketera',
    params: {
      p_servicio: 'IT',
      p_ticket: {
        email: 'real@example.com',
        tipo: 'eTracker',
        motivo: 'App',
        numero_gestion: 'IT-123'
      }
    }
  });
});

test('saves the Ventas IT number through the state RPC', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  caseType = 2;
  const response = await request('/actualizarEstadoTicketeraVentas', {
    method: 'PATCH',
    range: 5,
    body: {
      caso_id: 23,
      estado: 'cerrado ok',
      observacion: 'Se informa número IT',
      numero_it: 'IT-2026-1234'
    }
  });

  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(calls.find(({ name }) => name === 'actualizar_estado_ticketera'), {
    name: 'actualizar_estado_ticketera',
    params: {
      p_caso_id: 23,
      p_estado: 'cerrado ok',
      p_observacion: 'Se informa número IT',
      p_email: 'real@example.com',
      p_numero_it: 'IT-2026-1234'
    }
  });
});

test('passes the selected leader to the unified ticket listing RPC', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  const response = await request('/obtenerTickets?servicio=VENTAS&p_busqueda=All&lider=Equipo%20Ventas');

  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(({ name }) => name === 'obtener_tickets'), {
    name: 'obtener_tickets',
    params: {
      p_servicio: 'VENTAS',
      p_busqueda: 'All',
      p_fecha_desde: null,
      p_fecha_hasta: null,
      p_lider: 'Equipo Ventas'
    }
  });
});

test('saves the Degra IT number through the state RPC', async () => {
  tools = [{ id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' }];
  caseType = 4;
  const response = await request('/actualizarEstadoTicketeraDegra', {
    method: 'PATCH',
    range: 5,
    body: {
      caso_id: 23,
      estado: 'resuelto',
      observacion: 'Seguimiento iniciado',
      numero_it: 'IT-2026-456'
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(({ name }) => name === 'actualizar_estado_ticketera'), {
    name: 'actualizar_estado_ticketera',
    params: {
      p_caso_id: 23,
      p_estado: 'resuelto',
      p_observacion: 'Seguimiento iniciado',
      p_email: 'real@example.com',
      p_numero_it: 'IT-2026-456'
    }
  });
});

function request(path, { range = 0, email = 'real@example.com', method = 'GET', body, token, form } = {}) {
  const session = token ?? jwt.sign({ email, rango: range }, process.env.JWT_SECRET, { expiresIn: '5m' });
  return fetch(`${base}${path}`, {
    method,
    headers: {
      Cookie: `login-jwt=${session}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: form || (body ? JSON.stringify(body) : undefined)
  });
}

test('requires a valid session and rejects nonexistent or empty ranges', async () => {
  assert.equal((await request('/ticketera/acceso', { token: 'invalid' })).status, 401);
  for (const range of [6, 7, '', null, 'invalid', true, false, [1]]) {
    assert.equal((await request('/ticketera/acceso', { range })).status, 403);
  }
  assert.equal(calls.length, 0);
});

test('denies users without a ticketera assignment, including the view guard', async () => {
  assert.equal((await request('/ticketera/acceso')).status, 403);
  assert.equal((await request('/auth/validar-acceso?view=tickets')).status, 403);
});

test('derives permissions from signed email, never the body or a query override', async () => {
  tools = [{ id_herramienta: 11, nombre: 'Ticketera_VENTAS' }];
  const response = await request('/ticketera/acceso?mail=other@example.com');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }]);
  assert.deepEqual(calls, [{ name: 'obtener_herramientas_usuario', params: { p_mail: 'real@example.com' } }]);
  assert.equal((await request('/crearIT', {
    method: 'POST', body: { mail: 'onbo@example.com', rango: 1 }
  })).status, 403);
});

test('enforces every combination of assigned and requested ticketera for agent, leader and BO', async () => {
  const names = ['ONBOARDING', 'VENTAS', 'DEGRA'];
  for (const range of [0, 2, 5]) {
    for (let mask = 0; mask < 8; mask++) {
      tools = names.flatMap((name, index) => mask & (1 << index)
        ? [{ id_herramienta: 10 + index, nombre: `tool-${index}` }] : []);
      for (let index = 0; index < names.length; index++) {
        assert.equal((await request(`/allowed/${names[index]}`, { range })).status,
          mask & (1 << index) ? 200 : 403, `${range}/${mask}/${names[index]}`);
      }
    }
  }
});

test('developer, chief and manager retain all ticketera access without assignments', async () => {
  for (const range of [1, 3, 4]) {
    const response = await request('/ticketera/acceso', { range });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 3);
    assert.equal((await request('/auth/validar-acceso?view=tickets', { range })).status, 200);
  }
  assert.equal(calls.length, 0);
});

test('normalizes canonical tool names and does not grant unrelated tools', async () => {
  tools = [{ nombre: ' Ticketera_ABONO_DEGRA ' }, { id_herramienta: 99, nombre: 'Other' }];
  assert.equal((await request('/allowed/DEGRA')).status, 200);
  assert.equal((await request('/allowed/ONBOARDING')).status, 403);
});

test('fails explicitly on RPC errors and malformed permissions', async () => {
  toolsError = new Error('test unavailable');
  assert.equal((await request('/ticketera/acceso')).status, 500);
  toolsError = null;
  for (const value of [null, {}, [null], [{ nombre: 123 }]]) {
    tools = value;
    assert.equal((await request('/ticketera/acceso')).status, 502);
  }
});

test('blocks every ticketera surface before business RPCs for users without assignments', async () => {
  const paths = [
    ['GET', '/tickets/summary'], ['GET', '/tickets/statistics'], ['GET', '/tickets'],
    ['GET', '/tickets/00000000-0000-4000-8000-000000000001'],
    ['GET', '/tickets/00000000-0000-4000-8000-000000000001/attachments/0/download'],
    ['POST', '/tickets'], ['PATCH', '/tickets/00000000-0000-4000-8000-000000000001/state'],
    ['GET', '/obtenerTickets'], ['GET', '/obtenerTicketsVentas'], ['GET', '/obtenerTicketsDegra'],
    ['POST', '/crearTicketera'], ['POST', '/crearTicketeraTicket'], ['POST', '/crearIT'], ['POST', '/crearTicketeraTicketVentas'],
    ['POST', '/crearTicketeraTicketDegra'], ['PATCH', '/actualizarEstadoTicketera'],
    ['PATCH', '/actualizarEstadoTicketeraVentas'], ['PATCH', '/actualizarEstadoTicketeraDegra'],
    ['POST', '/subirImagenesTicketera'], ['GET', '/lideresTck'],
    ['GET', '/lideresTicketera?p_ticketera=VENTAS'], ['POST', '/tickets/analytics'],
    ['POST', '/tickets/analytics/detail'], ['POST', '/tickets/analytics/export'],
    ['GET', '/alertas-operativas?servicio=VENTAS']
  ];
  for (const [method, path] of paths) {
    assert.equal((await request(path, { method, range: 5 })).status, 403, path);
  }
  assert.ok(calls.every(({ name }) => name === 'obtener_herramientas_usuario'));
});

test('prevents cross-ticketera cases and leader lookups even when another tool is granted', async () => {
  tools = [{ id_herramienta: 10, nombre: 'Ticketera_ONBOARDING' }];
  caseType = 'VENTAS';
  assert.equal((await request('/actualizarEstadoTicketera', {
    method: 'PATCH', range: 5, body: { caso_id: 1, estado: 'resuelto', observacion: 'test' }
  })).status, 403);
  assert.equal((await request('/lideresTicketera?p_ticketera=VENTAS')).status, 403);
  const form = new FormData();
  form.append('caso_id', '1');
  form.append('imagenes', new Blob(['image'], { type: 'image/png' }), 'test.png');
  assert.equal((await request('/subirImagenesTicketera', { method: 'POST', form })).status, 403);
  assert.ok(calls.every(({ name }) => name === 'obtener_herramientas_usuario'));
});

test('global legacy statistics are not exposed to a single ticketera', async () => {
  tools = [{ id_herramienta: 10, nombre: 'Ticketera_ONBOARDING' }];
  assert.equal((await request('/tickets/statistics')).status, 403);
});

test('does not impose ticketera permissions on unrelated API routes', async () => {
  assert.equal((await request('/historico-test')).status, 200);
  assert.equal(calls.length, 0);
});
