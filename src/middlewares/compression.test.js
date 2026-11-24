const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');
const compression = require('compression');
const express = require('express');

test('compresses large responses when the client accepts gzip', async t => {
  const app = express();
  const payload = 'cxh-productivity-data,'.repeat(10000);
  app.use(compression());
  app.get('/', (_req, res) => res.json({ payload }));

  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const response = await new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/',
      headers: { 'Accept-Encoding': 'gzip' }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(response.headers.vary, /Accept-Encoding/i);
  assert.deepEqual(JSON.parse(gunzipSync(response.body).toString()), { payload });
});
