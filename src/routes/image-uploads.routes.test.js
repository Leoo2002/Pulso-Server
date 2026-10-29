const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');

const databasePath = require.resolve('../config/database');
const originalDatabase = require.cache[databasePath];
let uploads;
let inserts;
let removed;
let deleted;
let failInsert;
let caseType;
let caseReg;
const client = {
  rpc: async () => ({ data: [
    { nombre: 'TICKETERA_ONBOARDING' }, { nombre: 'TICKETERA_VENTAS' }
  ], error: null }),
  schema() { return this; },
  from(table) {
    let record;
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({
        data: table === 'lideres'
          ? { nombre: 'Lider', dni_lider: 12345678 }
          : { id: 1, id_tck: 'TEST-1', tipo_ticketera: caseType, tipo_reg: caseReg },
        error: null
      }),
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      insert(data) {
        record = data;
        inserts.push({ table, data });
        return this;
      },
      single: async () => ({ data: record, error: failInsert ? new Error('Insert failed') : null }),
      delete() { return this; },
      in(_column, paths) { deleted.push(...paths); return Promise.resolve({ error: null }); }
    };
  },
  storage: {
    from(bucket) {
      return {
        upload: async (path, buffer, options) => {
          uploads.push({ bucket, path, buffer, options });
          return { error: null };
        },
        remove: async (paths) => { removed.push(...paths); return { error: null }; }
      };
    }
  }
};
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: { supabase: client }
};
const ticketera = require('./ticketera.routes');
const tickets = require('./tickets.routes');
if (originalDatabase) require.cache[databasePath] = originalDatabase;
else delete require.cache[databasePath];

let server;
let base;
let image;
before(async () => {
  image = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#6040a0' }
  }).png().toBuffer();
  const app = express();
  app.use((req, _res, next) => {
    req.user = { rango: 5, email: 'test@example.com', name: 'Usuario Test' };
    next();
  });
  app.use(ticketera, tickets);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  uploads = [];
  inserts = [];
  removed = [];
  deleted = [];
  failInsert = false;
  caseType = 3;
  caseReg = 'TICKET';
});

async function post(route, images = [image]) {
  const form = new FormData();
  const fields = route === '/tickets' ? {
    type: 'ticket', userCode: 'U123456', leaderDni: '12345678',
    incidentDate: '2026-10-28', channel: 'digital',
    customerType: 'movil', customerDni: '12345678', motive: 'delivery'
  } : { caso_id: '1' };
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const buffer of images) {
    form.append(route === '/tickets' ? 'images' : 'imagenes',
      new Blob([buffer], { type: 'image/png' }), 'captura.png');
  }
  return fetch(`${base}${route}`, { method: 'POST', body: form });
}

for (const route of ['/subirImagenesTicketera', '/tickets']) {
  test(`${route}: uploads one optimized file and records its actual MIME type and size`, async () => {
    const response = await post(route);
    assert.equal(response.status, 201, await response.text());
    assert.equal(uploads.length, 1);
    const upload = uploads[0];
    assert.match(upload.path, /\.webp$/);
    assert.equal(upload.options.contentType, 'image/webp');
    assert.equal(upload.options.upsert, false);
    assert.ok(upload.buffer.length < image.length);
    assert.equal((await sharp(upload.buffer).metadata()).width, 1920);
    const record = inserts[0].data;
    if (route === '/tickets') {
      assert.equal(record.attachments.length, 1);
      assert.equal(record.attachments[0].contentType, 'image/webp');
      assert.equal(record.attachments[0].size, upload.buffer.length);
      assert.equal(record.attachments[0].name, 'captura.webp');
      assert.equal(record.attachments[0].path, upload.path);
    } else {
      assert.equal(record.tipo_mime, 'image/webp');
      assert.equal(record.tamano_bytes, upload.buffer.length);
      assert.equal(record.ruta_archivo, upload.path);
      assert.equal(record.nombre_original, 'captura.png');
    }
  });

  test(`${route}: rejects a corrupted later attachment before uploading any files`, async () => {
    const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await post(route, [image, corrupt]);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /No se pudo leer la imagen/);
    assert.equal(uploads.length, 0);
    assert.equal(inserts.length, 0);
  });

  test(`${route}: rolls back optimized objects if metadata persistence fails`, async () => {
    failInsert = true;
    const response = await post(route);
    assert.equal(response.status, 500);
    assert.equal(uploads.length, 1);
    assert.deepEqual(removed, [uploads[0].path]);
    if (route === '/subirImagenesTicketera') assert.deepEqual(deleted, removed);
  });
}

test('Ventas and ITracker PNG inputs remain supported even when stored as WebP', async () => {
  for (const [tipo, registro] of [[2, 'TICKET'], [3, 'ITRACKER']]) {
    caseType = tipo;
    caseReg = registro;
    const response = await post('/subirImagenesTicketera');
    assert.equal(response.status, 201, await response.text());
    assert.equal(uploads.at(-1).options.contentType, 'image/webp');
  }
});
