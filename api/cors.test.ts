/** CORS for the app served apart from the API (Apache + PM2, DEPLOYMENT.md): only APP_URL's origin. No database. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'mariadb';
import { appOrigin, createApp } from './server.ts';

const APP = 'http://45.80.152.66';

async function withApp(allowedOrigin: string | null, run: (base: string) => Promise<void>) {
  const server = createApp({} as Pool, { secureCookie: false, allowedOrigin }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test('CORS: the app origin gets its preflight and credentials; any other origin gets nothing', () =>
  withApp(APP, async (base) => {
    const preflight = await fetch(`${base}/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: APP, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), APP);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Content-Type/);

    const other = await fetch(`${base}/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://45.80.152.66:3005', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    assert.equal(other.status, 403);

    const plain = await fetch(`${base}/no-existe`, { headers: { Origin: APP } });
    assert.equal(plain.status, 404);
    assert.equal(plain.headers.get('access-control-allow-origin'), APP);
    assert.equal(plain.headers.get('vary'), 'Origin');
  }));

test('CSRF: a POST from another origin (another port, a sandbox, a no-referrer form) is refused before its handler', () =>
  withApp(APP, async (base) => {
    for (const origin of ['http://45.80.152.66:3005', 'null', 'https://45.80.152.66']) {
      const r = await fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { Origin: origin, Cookie: 'charales_sid=x' },
      });
      assert.equal(r.status, 403, origin);
      assert.equal(r.headers.get('set-cookie'), null, origin);
    }
    // The fake pool has no query(): getting here without a 500 means the handler never ran.
    const rpc = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { Origin: 'http://45.80.152.66:3005', 'Content-Type': 'text/plain' },
      body: '{}',
    });
    assert.equal(rpc.status, 403);
    // The app itself, and clients that send no Origin (curl, Postman, the tests), go through.
    const own = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Origin: APP } });
    assert.equal(own.status, 204);
    assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST' })).status, 204);
    // Reads are not affected (navigations send no Origin; CORS already hides the answer).
    const get = await fetch(`${base}/no-existe`, { headers: { Origin: 'http://otra.example' } });
    assert.equal(get.status, 404);
  }));

test('CORS: off without APP_URL (same-origin behind a proxy, as before)', () =>
  withApp(null, async (base) => {
    const r = await fetch(`${base}/no-existe`, { headers: { Origin: APP } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }));

test('appOrigin: http(s) only; an opaque origin never matches', () => {
  assert.equal(appOrigin('http://45.80.152.66/'), APP);
  assert.equal(appOrigin('https://escuela.example/app'), 'https://escuela.example');
  assert.equal(appOrigin('file:///x'), null);
  assert.equal(appOrigin(''), null);
  assert.equal(appOrigin(undefined), null);
});
