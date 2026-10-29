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
let listResult;
let signedPaths;
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
      if (name === 'actualizar_ticket_ventas') return { data: createResult, error: createError };
      if (name === 'obtener_tickets') return { data: listResult, error: null };
      if (name === 'obtener_analitica_ticketera_multi') {
        return { data: { servicio: params.p_servicio, kpis: {}, distribuciones: {}, volumen: [] }, error: null };
      }
      if (name === 'obtener_detalle_analitica_ticketera_multi') {
        return { data: { items: [], total: 0 }, error: null };
      }
      if (name === 'exportar_analitica_ticketera_multi') {
        return { data: { analitica: { kpis: {}, distribuciones: {}, volumen: [] },
          columnas: ['id'], items: [], total: 0 }, error: null };
      }
      if (name === 'obtener_usuarios_nomina') return { data: {
        usuario: 'UPREVIEW', rango: 0, segmentos: []
      }, error: null };
      throw new Error(`Unexpected business RPC: ${name}`);
    },
    schema: () => ({ from: () => query }),
    storage: { from: () => ({ createSignedUrl: async (path) => {
      signedPaths.push(path);
      return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
    } }) }
  } }
};
const { requireTicketeraAccess, sendTicketeraAccess, sendTicketeraPolicy, normalizeTicketera } = require('./ticketera-access');
const tickets = require('../routes/tickets.routes');
const ticketera = require('../routes/ticketera.routes');
const degra = require('../routes/degra-ticketera.routes');
const analytics = require('../routes/ticketera-analytics.routes');
const alerts = require('../routes/alertas-operativas.routes');
const auth = require('../routes/auth.routes');
const nomina = require('../routes/nomina.routes');
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
  app.get('/ticketera/permisos', requireTicketeraAccess(), sendTicketeraPolicy);
  app.get('/unrelated', (_req, res) => res.json({ ok: true }));
  app.get('/allowed/:ticketera', (req, res, next) =>
    requireTicketeraAccess(req.params.ticketera)(req, res, next), (_req, res) => res.json({ ok: true }));
  app.use('/auth', auth);
  app.use(analytics, tickets, alerts, ticketera, degra, nomina);
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
  listResult = [];
  signedPaths = [];
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
      estado: 'Cerrado OK',
      observacion: 'Se informa número IT',
      numero_it: 'IT-2026-1234'
    }
  });

  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(calls.find(({ name }) => name === 'actualizar_estado_ticketera'), {
    name: 'actualizar_estado_ticketera',
    params: {
      p_caso_id: 23,
      p_estado: 'Cerrado OK',
      p_observacion: 'Se informa número IT',
      p_email: 'real@example.com',
      p_numero_it: 'IT-2026-1234'
    }
  });
});

test('passes the selected leader to the unified ticket listing RPC', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  const response = await request('/obtenerTickets?servicio=VENTAS&p_busqueda=All&lider=Equipo%20Ventas&dateFrom=2026-10-01&dateTo=2026-10-29', { range: 2 });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(({ name }) => name === 'obtener_tickets'), {
    name: 'obtener_tickets',
    params: {
      p_servicio: 'VENTAS',
      p_busqueda: 'All',
      p_fecha_desde: '2026-10-01',
      p_fecha_hasta: '2026-10-29',
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
      estado: 'Resuelto',
      observacion: 'Seguimiento iniciado',
      numero_it: 'IT-2026-456'
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(({ name }) => name === 'actualizar_estado_ticketera'), {
    name: 'actualizar_estado_ticketera',
    params: {
      p_caso_id: 23,
      p_estado: 'Resuelto',
      p_observacion: 'Seguimiento iniciado',
      p_email: 'real@example.com',
      p_numero_it: 'IT-2026-456'
    }
  });
});

function request(path, { range = 0, email = 'real@example.com', method = 'GET', body, token, form } = {}) {
  const session = token ?? jwt.sign({
    email, rango: range, herramientas: tools, segmento: ['VENTAS MOVIL'], usuario: 'U123456', rol: 'Perfil'
  }, process.env.JWT_SECRET, { expiresIn: '5m' });
  return fetch(`${base}${path}`, {
    method,
    headers: {
      Cookie: `login-jwt=${session}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: form || (body ? JSON.stringify(body) : undefined)
  });
}

test('JWT-scoped analytics runs before the ONBOARDING-only legacy router for all services', async () => {
  for (const [servicio, id, nombre] of [
    ['VENTAS', 11, 'TICKETERA_VENTAS'],
    ['ONBOARDING', 10, 'TICKETERA_ONBOARDING'],
    ['DEGRA', 12, 'TICKETERA_ABONO_DEGRA']
  ]) {
    tools = [{ id_herramienta: id, nombre }];
    for (const suffix of ['', '/detail', '/export']) {
      const response = await request(`/tickets/analytics${suffix}`, {
        range: 2, method: 'POST', body: { servicio }
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(calls.at(-1).params.p_servicio, servicio);
      calls = [];
      const denied = await request(`/tickets/analytics${suffix}`, {
        range: 2, method: 'POST', body: { servicio: servicio === 'VENTAS' ? 'DEGRA' : 'VENTAS' }
      });
      assert.equal(denied.status, 403);
      assert.equal(calls.length, 0);
    }
  }
});

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

test('derives permissions from signed tools, never the body, query or a new RPC', async () => {
  tools = [{ id_herramienta: 11, nombre: 'Ticketera_VENTAS' }];
  const response = await request('/ticketera/acceso?mail=other@example.com');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }]);
  assert.deepEqual(calls, []);
  assert.equal((await request('/crearIT', {
    method: 'POST', body: { mail: 'onbo@example.com', rango: 1 }
  })).status, 403);
});

test('enforces every combination of assigned and requested ticketera for agent, leader and BO', async () => {
  const names = ['ONBOARDING', 'VENTAS', 'DEGRA'];
  for (const range of [0, 1, 2, 3, 4, 5]) {
    for (let mask = 0; mask < 8; mask++) {
      tools = names.flatMap((name, index) => mask & (1 << index)
        ? [{ id_herramienta: 10 + index,
          nombre: ['TICKETERA_ONBOARDING', 'TICKETERA_VENTAS', 'TICKETERA_ABONO_DEGRA'][index] }] : []);
      for (let index = 0; index < names.length; index++) {
        assert.equal((await request(`/allowed/${names[index]}`, { range })).status,
          mask & (1 << index) ? 200 : 403, `${range}/${mask}/${names[index]}`);
      }
    }
  }
});

test('no range bypasses the signed tool assignments', async () => {
  for (const range of [1, 3, 4]) {
    const response = await request('/ticketera/acceso', { range });
    assert.equal(response.status, 403);
    assert.equal((await request('/auth/validar-acceso?view=tickets', { range })).status, 403);
  }
  assert.equal(calls.length, 0);
});

test('normalizes canonical tool names and does not grant unrelated tools', async () => {
  tools = [{ id_herramienta: 12, nombre: ' Ticketera_ABONO_DEGRA ' }, { id_herramienta: 99, nombre: 'Other' }];
  assert.equal((await request('/allowed/DEGRA')).status, 200);
  assert.equal((await request('/allowed/ONBOARDING')).status, 403);
});

test('rejects missing or malformed signed permissions without consulting RPCs', async () => {
  for (const value of [null, {}, [null], [{ nombre: 123 }]]) {
    tools = value;
    assert.equal((await request('/ticketera/acceso')).status, 403);
  }
  assert.equal(calls.length, 0);
});

test('exposes server action permissions and profile from the verified JWT for every range', async () => {
  tools = [{ id_herramienta: 11, nombre: 'Ticketera_Ventas' }];
  for (const range of [0, 1, 2, 3, 4, 5]) {
    const response = await request('/ticketera/permisos', { range });
    assert.equal(response.status, 200);
    const policy = await response.json();
    assert.equal(policy.perfil.rango, range);
    assert.equal(policy.perfil.email, 'real@example.com');
    assert.deepEqual(policy.perfil.segmentos, [{ segmento: 'VENTAS MOVIL' }]);
    assert.equal(policy.permisos.list, range !== 0);
    assert.equal(policy.permisos.update, [1, 5].includes(range));
    assert.equal(policy.permisos.createAlert, range !== 0);
    assert.equal(policy.permisos.deleteAlert, range !== 0);
    assert.equal(policy.permisos.metrics, range !== 0);
    assert.equal(policy.permisos.previewProfile, range === 1);
    assert.equal(policy.herramientas.length, 1);
  }
  assert.equal(calls.length, 0);
});

test('agents cannot list with default, general filters, wildcard or All on any listing route', async () => {
  tools = [
    { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' },
    { id_herramienta: 11, nombre: 'TICKETERA_VENTAS' },
    { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' }
  ];
  for (const path of [
    '/obtenerTickets?servicio=ONBOARDING', '/obtenerTickets?servicio=VENTAS',
    '/obtenerTickets?servicio=DEGRA', '/obtenerTicketsVentas?', '/obtenerTicketsDegra?'
  ]) {
    for (const suffix of ['', '&p_busqueda=All', '&p_busqueda=%25', '&p_busqueda=___',
      '&p_busqueda=a%25', '&status=pendiente', '&lider=Equipo&dateFrom=2026-10-01']) {
      assert.equal((await request(path + suffix)).status, 403, path + suffix);
    }
    assert.equal((await request(path + '&p_busqueda=12345678')).status, 200, path);
    assert.equal((await request(path + '&scope=mine')).status, 200, path);
  }
  assert.equal((await request('/tickets?status=pendiente')).status, 403);
  assert.ok(calls.every(({ name }) => name === 'obtener_tickets'));
});

test('leader and superior default listings are scoped to one month and the selected ticketera', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  for (const range of [1, 2, 3, 4, 5]) {
    const response = await request('/obtenerTickets?servicio=VENTAS', { range });
    assert.equal(response.status, 200);
    const params = calls.at(-1).params;
    assert.equal(params.p_servicio, 'VENTAS');
    assert.match(params.p_fecha_desde, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(params.p_fecha_hasta, /^\d{4}-\d{2}-\d{2}$/);
    const days = (new Date(params.p_fecha_hasta) - new Date(params.p_fecha_desde)) / 86400000;
    assert.ok(days >= 28 && days <= 31);
    assert.equal((await request('/obtenerTickets?servicio=ONBOARDING', { range })).status, 403);
  }
});

test('only BO and Development can mutate ticket state even with the legacy testing flag', async () => {
  tools = [
    { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' },
    { id_herramienta: 11, nombre: 'TICKETERA_VENTAS' },
    { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' }
  ];
  process.env.TICKETERA_ALLOW_ANY_PROFILE = 'true';
  try {
    for (const range of [0, 2, 3, 4]) {
      for (const path of ['/actualizarEstadoTicketera', '/actualizarEstadoTicketeraVentas',
        '/actualizarEstadoTicketeraDegra', '/tickets/00000000-0000-4000-8000-000000000001/state']) {
        caseType = path.endsWith('Ventas') ? 2 : 3;
        const response = await request(path, { range, method: 'PATCH',
          body: { caso_id: 23, estado: 'Resuelto', observacion: 'forged' } });
        assert.equal(response.status, 403, `${range}/${path}`);
      }
    }
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.TICKETERA_ALLOW_ANY_PROFILE;
  }
});

test('only Development may query another profile for preview', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  for (const range of [0, 2, 3, 4, 5]) {
    for (const path of ['/obtenerUsuariosNomina', '/obtenerHerramientasUsuario']) {
      assert.equal((await request(path, { range, method: 'POST', body: { mail: 'other@example.com' } })).status, 403);
    }
  }
  assert.equal(calls.length, 0);
  const response = await request('/obtenerUsuariosNomina', {
    range: 1, method: 'POST', body: { mail: 'other@example.com' }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).usuario, 'UPREVIEW');
  assert.deepEqual(calls, [{ name: 'obtener_usuarios_nomina', params: { p_mail: 'other@example.com' } }]);
});

test('agent searches cannot use JSON field names to retrieve the whole ticketera', async () => {
  for (const [service, id, tool, alternate] of [
    ['ONBOARDING', 3, { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' }, null],
    ['VENTAS', 2, { id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }, '/obtenerTicketsVentas'],
    ['DEGRA', 4, { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' }, '/obtenerTicketsDegra']
  ]) {
    tools = [tool];
    listResult = [
      { id: 21, tipo_ticketera: id, email: 'user@example.com',
        ticket: { dni_cliente: '12345678' }, imagenes: [{ ruta_archivo: 'matched.png' }] },
      { id: 22, tipo_ticketera: id, email: 'other@example.com',
        ticket: { dni_cliente: '87654321' }, imagenes: [{ ruta_archivo: 'other.png' }] }
    ];
    for (const path of [`/obtenerTickets?servicio=${service}&`, ...(alternate ? [`${alternate}?`] : [])]) {
      signedPaths = [];
      const byKey = await request(`${path}p_busqueda=email`);
      assert.equal(byKey.status, 200);
      assert.deepEqual(await byKey.json(), []);
      assert.deepEqual(signedPaths, []);
      const byValue = await request(`${path}p_busqueda=12345678`);
      assert.equal(byValue.status, 200);
      assert.deepEqual((await byValue.json()).map((ticket) => ticket.id), [21]);
      assert.deepEqual(signedPaths, ['matched.png']);
    }
  }
});

test('personal scope filters by JWT email before signing any case attachments', async () => {
  for (const [service, id, tool] of [
    ['ONBOARDING', 3, { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' }],
    ['VENTAS', 2, { id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }],
    ['DEGRA', 4, { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' }]
  ]) {
    tools = [tool];
    listResult = [
      { id: 21, tipo_ticketera: id, email: ' REAL@example.com ', imagenes: [{ ruta_archivo: 'mine.png' }] },
      { id: 22, tipo_ticketera: id, email: 'other@example.com', imagenes: [{ ruta_archivo: 'other.png' }] }
    ];
    signedPaths = [];
    const response = await request(`/obtenerTickets?servicio=${service}&scope=mine&email=other@example.com`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((ticket) => ticket.id), [21]);
    assert.deepEqual(signedPaths, ['mine.png']);
  }
});

test('rejects rows from another ticketera before signing attachments, including alternate listing routes', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  listResult = [{ id: 21, tipo_ticketera: 3, imagenes: [{ ruta_archivo: 'forbidden.png' }] }];
  for (const path of ['/obtenerTickets?servicio=VENTAS&p_busqueda=12345', '/obtenerTicketsVentas?p_busqueda=12345']) {
    assert.equal((await request(path)).status, 502);
  }
  assert.deepEqual(signedPaths, []);
});

test('BO and Development may update cases but never outside the actual ticketera', async () => {
  tools = [{ id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' }];
  for (const range of [1, 5]) {
    caseType = 3;
    const options = { range, method: 'PATCH',
      body: { caso_id: 23, estado: 'Resuelto', observacion: 'Seguimiento' } };
    assert.equal((await request('/actualizarEstadoTicketera', options)).status, 200);
    caseType = 2;
    assert.equal((await request('/actualizarEstadoTicketera', options)).status, 403);
  }
});

test('passes the dropdown state text unchanged and rejects internal codes in every ticketera', async () => {
  const scenarios = [
    ['/actualizarEstadoTicketera', 3, { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' },
      ['En gestión', 'Reportado', 'Resuelto', 'Cancelado Duplicado', 'Cancelado No Corresponde'],
      ['en_curso', 'pendiente', 'resuelto', 'cancelado_duplicado', '❌ Cancelado Duplicado', 'en gestion']],
    ['/actualizarEstadoTicketeraDegra', 4, { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' },
      ['En gestión', 'Reportado', 'Resuelto', 'Cancelado Duplicado', 'Cancelado No Corresponde'],
      ['en_curso', 'pendiente', 'resuelto', 'cancelado_no_corresponde', '🚫 Cancelado No Corresponde']],
    ['/actualizarEstadoTicketeraVentas', 2, { id_herramienta: 11, nombre: 'TICKETERA_VENTAS' },
      ['Reportado', 'Cerrado OK', 'No corresponde', 'No corresponde duplicado', 'Derivación incorrecta'],
      ['cerrado ok', 'reportado', 'derivacion incorrecta', 'Derivacion incorrecta']]
  ];
  for (const [path, type, tool, accepted, rejected] of scenarios) {
    tools = [tool];
    caseType = type;
    for (const estado of accepted) {
      calls = [];
      const response = await request(path, { method: 'PATCH', range: 5,
        body: { caso_id: 23, estado, observacion: 'Cambio', numero_it: 'IT-1' } });
      assert.equal(response.status, 200, `${path} ${estado}`);
      assert.equal(calls.find(({ name }) => name === 'actualizar_estado_ticketera').params.p_estado, estado);
    }
    for (const estado of rejected) {
      calls = [];
      const response = await request(path, { method: 'PATCH', range: 5,
        body: { caso_id: 23, estado, observacion: 'Cambio', numero_it: 'IT-1' } });
      assert.equal(response.status, 400, `${path} ${estado}`);
      assert.equal(calls.some(({ name }) => name === 'actualizar_estado_ticketera'), false);
    }
  }
});

test('updates Sales without an IT number through the Sales RPC, preserving optional fields and literal states', async () => {
  tools = [{ id_herramienta: 11, nombre: 'TICKETERA_VENTAS' }];
  caseType = 2;
  const updates = [
    ...['Reportado', 'Cerrado OK', 'No corresponde', 'No corresponde duplicado', 'Derivación incorrecta']
      .map((estado) => ({ estado })),
    { observacion: 'Seguimiento sin cambiar estado' },
    { estado: 'Cerrado OK', observacion: 'Caso resuelto' }
  ];
  for (const update of updates) {
    calls = [];
    const response = await request('/actualizarEstadoTicketeraVentas', {
      method: 'PATCH', range: 5, body: { caso_id: 23, ...update }
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(calls.find(({ name }) => name === 'actualizar_ticket_ventas'), {
      name: 'actualizar_ticket_ventas',
      params: {
        p_caso_id: 23,
        p_email: 'real@example.com',
        p_observacion: update.observacion || null,
        p_estado_nuevo: update.estado || null
      }
    });
    assert.equal(calls.some(({ name }) => name === 'actualizar_estado_ticketera'), false);
  }
});

test('does not execute the old unscoped statistics RPC even with every tool', async () => {
  tools = [
    { id_herramienta: 10, nombre: 'TICKETERA_ONBOARDING' },
    { id_herramienta: 11, nombre: 'TICKETERA_VENTAS' },
    { id_herramienta: 12, nombre: 'TICKETERA_ABONO_DEGRA' }
  ];
  assert.equal((await request('/tickets/statistics', { range: 1 })).status, 410);
  assert.deepEqual(calls, []);
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
    method: 'PATCH', range: 5, body: { caso_id: 1, estado: 'Resuelto', observacion: 'test' }
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
