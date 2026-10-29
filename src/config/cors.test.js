const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const express = require('express');
const cors = require('cors');
const corsOptions = require('./cors');

test('CORS allows explicit origins and preflight requests without allowing other origins', async (t) => {
  const app = express();
  app.use(cors(corsOptions));
  app.get('/', (req, res) => res.send('ok'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const origins = [
    'https://pulso-arg.netlify.app',
    'http://localhost:4200',
    'http://localhost:3000',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
  ];

  for (const origin of origins) {
    const response = await fetch(url, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type,Authorization');
  }

  for (const origin of [
    'https://untrusted.example',
    'http://pulso-arg.netlify.app',
    'https://pulso-arg.netlify.app.untrusted.example'
  ]) {
    for (const method of ['GET', 'OPTIONS']) {
      const response = await fetch(url, { method, headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  }
});
