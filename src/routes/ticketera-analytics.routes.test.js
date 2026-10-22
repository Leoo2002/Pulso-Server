const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const databasePath = require.resolve('../config/database');
const originalDatabase = require.cache[databasePath];
let result;
let calls = [];
let missingCases = [];
let missingFilters = [];
const missingQuery = {
  select: () => missingQuery,
  is: () => missingQuery,
  in: (column, values) => { missingFilters.push({ column, values }); return missingQuery; },
  then: (resolve, reject) => Promise.resolve({ data: missingCases, error: null }).then(resolve, reject)
};
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { supabase: { schema: () => ({ from: () => missingQuery }), rpc: async (name, params) => {
    calls.push({ name, params });
    return result;
  } } }
};
const router = require('./ticketera-analytics.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-test-range']) req.user = { rango: req.headers['x-test-range'] };
    next();
  });
  app.use(router);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function post(body, range = '2', detail = false) {
  return fetch(`${base}/tickets/analytics${detail ? '/detail' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(range ? { 'x-test-range': range } : {}) },
    body: JSON.stringify(body)
  });
}

test('JWT profile must allow metrics; rango 0 and missing/invalid profiles cannot call RPC', async () => {
  for (const range of ['0', '', 'invalid', '7']) {
    calls = [];
    assert.equal((await post({}, range)).status, 403);
    assert.equal(calls.length, 0);
  }
});

test('multiple filters are passed as RPC arguments; null date means no limit', async () => {
  result = { data: { kpis: {}, distribuciones: {}, volumen: [] }, error: null };
  const response = await post({ desde: null, hasta: '2026-10-22',
    lideres: ['A', 'B'], canales: ['digital', 'telefonico'], tipos: ['ticket'], estados: [],
    granularidad: 'semana', zona_horaria: 'America/Argentina/Buenos_Aires' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), {
    name: 'obtener_analitica_ticketera',
    params: { p_hasta: '2026-10-22', p_lideres: ['A', 'B'],
      p_canales: ['digital', 'telefonico'], p_tipos: ['ticket'], p_estados: [],
      p_granularidad: 'semana', p_zona_horaria: 'America/Argentina/Buenos_Aires' }
  });
});

test('invalid filter shapes are rejected before contacting Supabase', async () => {
  for (const body of [[], { lideres: 'A' }, { canales: [null] }, { estados: [''] },
    { ignored: 'value' }, { desde: {} }, { lideres: Array(201).fill('A') }]) {
    calls = [];
    assert.equal((await post(body)).status, 400);
    assert.equal(calls.length, 0);
  }
});

test('detail passes the selection and pagination, without granularity', async () => {
  result = { data: { items: [], total: 0, pagina: 2, tamano: 20 }, error: null };
  const response = await post({ dimension: 'submotivo', valor: 'Otros', motivo: 'delivery',
    pagina: 2, tamano: 20, granularidad: 'auto' }, '5', true);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), { name: 'obtener_detalle_analitica_ticketera',
    params: { p_dimension: 'submotivo', p_valor: 'Otros', p_motivo: 'delivery', p_pagina: 2, p_tamano: 20 } });
  for (const body of [{ pagina: 0 }, { tamano: 101 }, { pagina: 1.5 }]) {
    assert.equal((await post(body, '2', true)).status, 400);
  }
});

test('database validation errors and malformed responses surface as failures', async () => {
  result = { data: null, error: { code: '22023', message: 'Fecha inicial inválida.' } };
  const invalid = await post({});
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'Fecha inicial inválida.');
  result = { data: [], error: null };
  assert.equal((await post({})).status, 502);
  result = { data: { items: 'invalid' }, error: null };
  assert.equal((await post({}, '2', true)).status, 502);
});

test('missing dates include ticket identifiers and exclusion flags respecting applied filters', async () => {
  missingCases = [
    { caso_id: 28, id_tck: 'TCK-28', estado: 'pendiente_bo' },
    { caso_id: 29, id_tck: 'TCK-29', estado: 'resuelto' }
  ];
  missingFilters = [];
  result = { data: { kpis: {}, distribuciones: {}, volumen: [],
    calidad_datos: { sin_fecha_carga: 2 } }, error: null };
  const response = await post({ desde: '2026-10-01', lideres: ['A'],
    canales: ['digital'], tipos: ['ticket'], estados: ['pendiente_bo'] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).calidad_datos.casos_sin_fecha, [
    { caso_id: 28, id_tck: 'TCK-28', excluido_por_fechas: true },
    { caso_id: 29, id_tck: 'TCK-29', excluido_por_fechas: false }
  ]);
  assert.deepEqual(missingFilters, [
    { column: 'lider', values: ['A'] }, { column: 'canal', values: ['digital'] },
    { column: 'tipo', values: ['ticket'] }
  ]);
  const unbounded = await post({});
  assert.ok((await unbounded.json()).calidad_datos.casos_sin_fecha.every((item) => !item.excluido_por_fechas));
});
