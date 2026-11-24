const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const databasePath = require.resolve('../config/database');
const originalDatabase = require.cache[databasePath];
let calls = [];
let result;
let resolverRpc;
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { supabase: { rpc: (name, params) => {
    calls.push({ name, params });
    return { abortSignal: signal => resolverRpc(signal) };
  } } }
};
const router = require('./metricas.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];

let server;
let base;
beforeEach(() => { resolverRpc = async () => result; });
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-test-range']) req.user = {
      rango: req.headers['x-test-range'],
      segmento: (req.headers['x-test-services'] || 'SOPORTE-RRSS,ONBOARDING').split(','),
      lider: req.headers['x-test-leader'] ?? 'LIDER A'
    };
    next();
  });
  app.use(router);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

const filtros = { servicio: 'SOPORTE-RRSS', fecha_desde: '2026-09-01', fecha_hasta: null };
function payload(servicio = 'SOPORTE-RRSS', lider = 'LIDER A') {
  return { servicio, fuente: 'mensual', periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
    general: { cxh: 2.5 }, por_lider: [{ lider, agentes: [] }] };
}
function post(body = filtros, rango = '0', lider = 'LIDER A', ruta = '/kpis/productividad', signal) {
  return fetch(`${base}${ruta}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(rango ? { 'x-test-range': rango } : {}), 'x-test-leader': lider },
    body: JSON.stringify(body), signal
  });
}

test('NPS uses the same validated filters and returns RPC summaries with service context', async () => {
    const data = { periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
      general: { cantidad_encuestas: 1318, cantidad_calificadas: 1288, nps: 58 }, por_lider: [] };
    result = { data, error: null };
    const response = await post({ ...filtros, servicio: ' ONBOARDING ', filtro_canal: ' DIGITAL ',
      filtro_lider: '', filtro_empleado_id: 42 }, '0', '', '/kpis/nps');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ...data, servicio: 'ONBOARDING' });
    assert.deepEqual(calls.at(-1), { name: 'consultar_nps', params: {
      servicio: 'ONBOARDING', fecha_desde: '2026-09-01', fecha_hasta: null,
      filtro_lider: null, filtro_canal: 'DIGITAL', filtro_empleado_id: 42, filtro_legajo: null
    } });
  });

test('NPS rejects invalid/sessionless requests and exposes failures without success-shaped defaults', async () => {
    for (const [body, rango, status] of [
      [filtros, '', 401], [filtros, '7', 403],
      [{ ...filtros, fecha_desde: '2026-02-30' }, '0', 400],
      [{ ...filtros, filtro_empleado_id: 1, filtro_legajo: 'U1' }, '0', 400]
    ]) {
      calls = [];
      assert.equal((await post(body, rango, '', '/kpis/nps')).status, status);
      assert.equal(calls.length, 0);
    }
    result = { data: null, error: { code: 'P0001', message: 'Servicio sin filtros.' } };
    const response = await post(filtros, '0', '', '/kpis/nps');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Servicio sin filtros.');
    result = { data: { general: {}, periodo: {}, por_lider: [] }, error: null };
    assert.equal((await post(filtros, '0', '', '/kpis/nps')).status, 502);
  });

test('FCR passes the service under the RPC-specific argument and returns a compact summary', async () => {
  const data = { servicio: 'ONBOARDING', periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
    general: { cantidadRegistros: 649, totalInteracciones: 701, totalRecallEfectivo: 133 }, por_lider: [] };
  result = { data, error: null };
  const response = await post({ ...filtros, servicio: ' ONBOARDING ', filtro_canal: ' DIGITAL ',
    filtro_lider: '', filtro_empleado_id: 42 }, '0', '', '/kpis/fcr');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), data);
  assert.deepEqual(calls.at(-1), { name: 'consultar_fcr_resumen', params: {
    filtro_servicio: 'ONBOARDING', fecha_desde: '2026-09-01', fecha_hasta: null,
    filtro_lider: null, filtro_canal: 'DIGITAL', filtro_empleado_id: 42, filtro_legajo: null
  } });
});

test('FCR detail and tabulations pass pagination, identity and category filters', async () => {
  const periodo = { desde: '2026-09-01', hasta: '2026-09-30' };
  result = { data: { servicio: 'ONBOARDING', periodo, total: 3, pagina: 2, registros: [] }, error: null };
  const detail = await post({ ...filtros, servicio: 'ONBOARDING', filtro_agente: 'AGENTE',
    filtro_jefe: 'JEFE', filtro_recall: 'CON_RECALL', filtro_tab_contacto: 'SEGUNDO',
    filtro_tab_nivel: 2, filtro_tab: ' CONSULTA ', pagina: 2, tamano_pagina: 1 }, '0', '', '/kpis/fcr/detalle');
  assert.equal(detail.status, 200);
  assert.deepEqual(calls.at(-1).params, { filtro_servicio: 'ONBOARDING',
    fecha_desde: '2026-09-01', fecha_hasta: null, filtro_canal: null, filtro_empleado_id: null,
    filtro_legajo: null, filtro_lider: null, filtro_agente: 'AGENTE', filtro_jefe: 'JEFE',
    filtro_recall: 'CON_RECALL', filtro_tab_contacto: 'SEGUNDO', filtro_tab_nivel: 2,
    filtro_tab: 'CONSULTA', pagina: 2, tamano_pagina: 1 });
  result = { data: { servicio: 'ONBOARDING', periodo, total: 3, sin_etiqueta: 2, categorias: [] }, error: null };
  const tabs = await post({ ...filtros, servicio: 'ONBOARDING', filtro_contacto: 'PRIMERO', nivel: 4, limite: 10 },
    '0', '', '/kpis/fcr/tabulaciones');
  assert.equal(tabs.status, 200);
  assert.equal(calls.at(-1).name, 'consultar_fcr_tabulaciones');
  assert.equal(calls.at(-1).params.filtro_contacto, 'PRIMERO');
  assert.equal(calls.at(-1).params.nivel, 4);
});

test('FCR rejects invalid filters and makes missing migrations and malformed responses visible', async () => {
  for (const body of [
    { ...filtros, pagina: 0 }, { ...filtros, tamano_pagina: 201 },
    { ...filtros, filtro_recall: 'OTRO' }, { ...filtros, filtro_tab_nivel: 5 }
  ]) {
    calls = [];
    assert.equal((await post(body, '0', '', '/kpis/fcr/detalle')).status, 400);
    assert.equal(calls.length, 0);
  }
  calls = [];
  assert.equal((await post(filtros, '', '', '/kpis/fcr')).status, 401);
  assert.equal(calls.length, 0);
  result = { data: null, error: { code: 'PGRST202', message: 'Missing function' } };
  const missing = await post(filtros, '0', '', '/kpis/fcr');
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /migración de FCR/);
  result = { data: { servicio: 'OTRO', periodo: {}, general: { cantidadRegistros: 0,
    totalInteracciones: 0, totalRecallEfectivo: 0 }, por_lider: [] }, error: null };
  assert.equal((await post(filtros, '0', '', '/kpis/fcr')).status, 502);
});

test('a stalled KPI RPC is aborted with a visible 504 and the next request can succeed', async t => {
  const originalSetTimeout = global.setTimeout;
  let expirar;
  t.mock.method(global, 'setTimeout', (callback, ms, ...args) => {
    const timer = originalSetTimeout(callback, ms, ...args);
    if (ms === 30000) expirar = () => callback(...args);
    return timer;
  });
  let iniciar;
  const iniciada = new Promise(resolve => { iniciar = resolve; });
  let signalRpc;
  resolverRpc = signal => new Promise(resolve => {
    signalRpc = signal;
    signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError' } }), { once: true });
    iniciar();
  });
  let respondio = false;
  const peticion = post(filtros, '0', '', '/kpis/fcr/detalle').then(response => {
    respondio = true;
    return response;
  });
  await iniciada;
  assert.equal(respondio, false);
  assert.equal(signalRpc.aborted, false);
  expirar();
  const response = await peticion;
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /30 segundos/);
  assert.equal(signalRpc.aborted, true);
  const data = { servicio: 'SOPORTE', periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
    total: 0, pagina: 1, registros: [] };
  resolverRpc = async () => ({ data, error: null });
  const reintento = await post({ ...filtros, servicio: 'SOPORTE' }, '0', '', '/kpis/fcr/detalle');
  assert.equal(reintento.status, 200);
  assert.deepEqual(await reintento.json(), data);
});

test('disconnecting a KPI client aborts the outstanding Supabase request', async () => {
  let iniciar;
  const iniciada = new Promise(resolve => { iniciar = resolve; });
  let terminar;
  const cancelada = new Promise(resolve => { terminar = resolve; });
  let signalRpc;
  resolverRpc = signal => new Promise(resolve => {
    signalRpc = signal;
    signal.addEventListener('abort', () => {
      resolve({ data: null, error: { message: 'AbortError' } });
      terminar();
    }, { once: true });
    iniciar();
  });
  const controlador = new AbortController();
  const peticion = post(filtros, '0', '', '/kpis/fcr/tabulaciones', controlador.signal);
  const rechazada = assert.rejects(peticion, { name: 'AbortError' });
  await iniciada;
  controlador.abort();
  await rechazada;
  await cancelada;
  assert.equal(signalRpc.aborted, true);
});

test('context suggests JWT services and leader without locking filters while roles are pending', async () => {
  const response = await fetch(`${base}/kpis/contexto`, { headers: { 'x-test-range': '0' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    servicios: ['SOPORTE-RRSS', 'ONBOARDING'], lider: 'LIDER A', restringido: false
  });
});

test('any service and leader typed for testing reach the RPC with all seven parameters', async () => {
  result = { data: payload('SOPORTE', 'LIDER B'), error: null };
  const response = await post({ ...filtros, servicio: 'SOPORTE', filtro_lider: 'LIDER B' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls.at(-1), { name: 'consultar_cxh', params: {
    servicio: 'SOPORTE', fecha_desde: '2026-09-01', fecha_hasta: null,
    filtro_lider: 'LIDER B', filtro_canal: null, filtro_empleado_id: null, filtro_legajo: null
  } });
});

test('non-agents can filter their assigned service, dates, channel and employee', async () => {
  result = { data: { ...payload('ONBOARDING', 'LIDER B'), fuente: 'diaria' }, error: null };
  assert.equal((await post({ servicio: 'ONBOARDING', fecha_desde: '2026-09-01',
    fecha_hasta: '2026-09-03', filtro_canal: 'DIGITAL', filtro_empleado_id: 42,
    filtro_lider: 'LIDER B' }, '2')).status, 200);
  assert.deepEqual(calls.at(-1).params, {
    servicio: 'ONBOARDING', fecha_desde: '2026-09-01', fecha_hasta: '2026-09-03',
    filtro_canal: 'DIGITAL', filtro_empleado_id: 42, filtro_legajo: null, filtro_lider: 'LIDER B'
  });
  result = { data: payload(), error: null };
  assert.equal((await post(filtros, '2')).status, 200);
  assert.equal(calls.at(-1).params.filtro_lider, null);
});

test('missing sessions and ranks without metrics access cannot call RPC', async () => {
  for (const [body, rango, lider, status] of [
    [filtros, '', '', 401], [filtros, 'invalid', '', 403], [filtros, '7', '', 403]
  ]) {
    calls = [];
    assert.equal((await post(body, rango, lider)).status, status);
    assert.equal(calls.length, 0);
  }
});

test('invalid dates, duplicate identity filters and malformed values are rejected before RPC', async () => {
  for (const cambios of [
    { fecha_desde: '2026-02-30' }, { fecha_hasta: '2026-08-31' },
    { filtro_empleado_id: 42, filtro_legajo: 'U42' }, { filtro_empleado_id: 2147483648 },
    { filtro_canal: ['DIGITAL'] }, { servicio: ['ONBOARDING'] }, { rpc: 'otra_funcion' }
  ]) {
    calls = [];
    assert.equal((await post({ ...filtros, ...cambios }, '2')).status, 400);
    assert.equal(calls.length, 0);
  }
});

test('Supabase business errors are visible, failures are not empty successful datasets', async () => {
  result = { data: null, error: { code: 'P0001', message: 'No existe configuracion del servicio.' } };
  const response = await post();
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, result.error.message);
  result = { data: null, error: { code: 'PGRST202', message: 'Missing function' } };
  assert.equal((await post()).status, 500);
  for (const data of [null, [], { ...payload(), servicio: 'OTRO' }]) {
    result = { data, error: null };
    assert.equal((await post()).status, 502);
  }
});
