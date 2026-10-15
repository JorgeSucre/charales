/**
 * Browser E2E (HU-074, HU-071, HU-002/003): the production build served on the same origin as the API — as in
 * production — over a temporary MariaDB with the demo data, driven in a headless Chrome. Every role logs in through
 * the form and opens every page of its menu at phone, tablet and desktop widths: the page must load without errors,
 * without console exceptions and without horizontal scroll; the menu collapses on phones.
 *
 *   npm run e2e        # builds, then runs this file (needs MariaDB and Google Chrome; CHROME_PATH to override)
 * E2E_SHOTS=<dir> saves a screenshot of every page at each width.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { openTestDb, type TestDb } from '../api/test-db.ts';
import { createApp, createPool } from '../api/server.ts';
import { chromeAvailable, openBrowser, type Page } from './browser.ts';

const DIST = new URL('../dist/project/browser/', import.meta.url).pathname;
const SHOTS = process.env['E2E_SHOTS'];
const WIDTHS = [375, 768, 1280] as const;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

let t: TestDb;
let web: Server;
let app: string;
let page: Page;

/** Same origin: static build + reverse proxy of /api, /auth and /health to the API (what production needs). */
/** Where the proxy sends API requests; a test can point it at a new API process (restart). */
let apiBase = '';

function serve(): Server {
  return createServer((req, res) => {
    const api = new URL(apiBase);
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (/^\/(api|auth|health)(\/|$)/.test(path)) {
      const upstream = request(
        {
          host: api.hostname,
          port: api.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      req.pipe(upstream);
      return;
    }
    const file = join(DIST, path);
    const target = existsSync(file) && extname(file) ? file : join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(readFileSync(target));
  }).listen(0);
}

before(async () => {
  assert.ok(chromeAvailable(), 'Google Chrome no encontrado (CHROME_PATH)');
  assert.ok(existsSync(join(DIST, 'index.html')), 'Falta el build: npm run build');
  t = await openTestDb('ef_e2e', { realClock: true }); // the browser runs on its own, real clock
  apiBase = t.base;
  web = serve();
  await new Promise((resolve) => web.once('listening', resolve));
  app = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  page = await openBrowser();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => {
  await page?.close();
  web?.close();
  await t?.close();
});

const settled = `document.querySelector('main') && !document.querySelector('[role=status]')?.textContent?.includes('Cargando')`;

/** Ends any session (server and local copy) on the app's origin. */
async function logoutAll(): Promise<void> {
  await page.goto(`${app}/forgot-password`);
  await page.eval(`fetch('/auth/logout', { method: 'POST' }).then(() => sessionStorage.clear())`);
}

async function login(email: string): Promise<string> {
  await logoutAll();
  await page.size(1280, 900);
  await page.goto(`${app}/login`);
  await page.until(`document.querySelector('input[type=email]')`);
  await page.eval(`(() => {
    const set = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
    set('input[type=email]', ${JSON.stringify(email)});
    set('input[type=password]', 'demo1234');
    document.querySelector('button[type=submit]').click();
  })()`);
  await page.until(`!location.pathname.startsWith('/login')`);
  await page.until(settled);
  return page.eval<string>('location.pathname');
}

async function check(path: string, width: number, who: string, home: string): Promise<string[]> {
  await page.size(width, 900);
  await page.goto(`${app}${path}`);
  await page.until(settled);
  const problems: string[] = [];
  const state = await page.eval<{
    path: string;
    overflow: number;
    alerts: string[];
    toggle: boolean;
    clipped: number;
    english: string | null;
  }>(`({
    path: location.pathname,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    alerts: [...document.querySelectorAll('.alert.error')].map((e) => e.textContent.trim()),
    toggle: !!document.querySelector('.menu-toggle')?.offsetParent,
    clipped: [...document.querySelectorAll('.kpi, .card')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    english: (document.querySelector('main').innerText.match(/\\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Apr|May|Aug|Dec)\\b/) ?? [])[0] ?? null,
  })`);
  // «Inicio» (/) takes coaches and tutors to their own panel (AuthService.homeUrl).
  if (state.path !== path && !(path === '/' && state.path === home))
    problems.push(`redirigió a ${state.path}`);
  if (state.overflow > 1) problems.push(`scroll horizontal de ${state.overflow}px`);
  if (state.alerts.length) problems.push(`error: ${state.alerts.join(' | ')}`);
  if (state.clipped) problems.push(`${state.clipped} tarjeta(s) con texto desbordado`);
  if (state.english) problems.push(`texto en inglés: «${state.english}»`);
  if (width === 375 && !state.toggle) problems.push('el menú no se colapsa');
  if (width === 1280 && state.toggle) problems.push('botón de menú visible en escritorio');
  const errors = page.errors();
  if (errors.length) problems.push(`consola: ${errors.join(' | ').slice(0, 200)}`);
  if (SHOTS)
    writeFileSync(
      join(SHOTS, `${who}${path.replaceAll('/', '_') || '_inicio'}_${width}.png`),
      await page.screenshot(),
    );
  return problems.map((p) => `${who} ${path} @${width}: ${p}`);
}

const ROLES: [string, string][] = [
  ['admin@example.com', '/'],
  ['secretaria@example.com', '/'],
  ['coach@example.com', '/coach'],
  ['tutor@example.com', '/portal'],
  ['marta@example.com', '/coach'],
];

for (const [email, home] of ROLES) {
  test(`${email}: logs in through the form, lands on ${home} and every menu page works at 375/768/1280 px`, async () => {
    assert.equal(await login(email), home, 'HU-001: redirect by role');
    const links = await page.eval<string[]>(
      `[...new Set([...document.querySelectorAll('#nav-links a')].map((a) => a.getAttribute('href')))]`,
    );
    assert.ok(links.length >= 2, 'menu by role');
    const who = email.split('@')[0]!;
    const problems: string[] = [];
    for (const link of links)
      for (const width of WIDTHS) problems.push(...(await check(link, width, who, home)));
    assert.deepEqual(problems, []);
  });
}

test('HU-002/003: direct URLs are guarded by the server session — anonymous → login, tutor → forbidden, logout ends it', async () => {
  await logoutAll();
  await page.goto(`${app}/admin/players`);
  await page.until(`location.pathname === '/login'`);
  await login('tutor@example.com');
  await page.goto(`${app}/admin/players`);
  await page.until(`location.pathname === '/forbidden'`);
  await page.goto(`${app}/portal`);
  await page.until(settled);
  await page.eval(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Salir').click()`,
  );
  await page.until(`location.pathname === '/login'`);
  await page.goto(`${app}/portal`);
  await page.until(`location.pathname === '/login'`);
  page.errors();
});

test('HU-004.3 / HU-002.4: an account deactivated on the server is sent to the login on its next navigation', async () => {
  await login('marta@example.com');
  const admin = await t.login('admin@example.com');
  await t.ok(t.call(admin, 'UserService', 'setActive', 6, false));
  await page.goto(`${app}/coach`);
  await page.until(`location.pathname === '/login' && location.search.includes('expired=1')`);
  await t.ok(t.call(admin, 'UserService', 'setActive', 6, true));
  page.errors();
});

test('HU-008 through the UI: the secretary registers a player with the form and it is stored in MariaDB', async () => {
  await login('secretaria@example.com');
  await page.goto(`${app}/admin/players/new`);
  await page.until(`document.querySelector('form input')`);
  const before = await t.count('SELECT COUNT(*) AS n FROM jugadores');
  await page.eval(`(() => {
    const set = (name, v) => { const i = document.querySelector('[formcontrolname=' + name + ']'); i.value = v; i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    set('firstName', 'Desde'); set('lastName1', 'Navegador'); set('birthDate', '2016-04-04');
    document.querySelector('form button[type=submit]').click();
  })()`);
  await page.until(`location.pathname !== '/admin/players/new'`, 8000);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM jugadores'), before + 1);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM jugadores WHERE nombre = 'Desde' AND apellido_paterno = 'Navegador'",
    ),
    1,
  );
  assert.deepEqual(page.errors(), []);
});

const DETAILS: [string, string[]][] = [
  [
    'admin@example.com',
    [
      '/admin/players/1',
      '/admin/players/1/edit',
      '/admin/billing/receipts/1',
      '/sports/categories/1',
      '/sports/trainings/1',
      '/sports/competitions/1',
    ],
  ],
  ['coach@example.com', ['/coach/sessions/3']],
  ['tutor@example.com', ['/portal/children/1', '/portal/children/2']],
];

for (const [email, paths] of DETAILS) {
  test(`${email}: detail pages (record, receipt, attendance capture, child) work at 375/768/1280 px`, async () => {
    const home = await login(email);
    const who = email.split('@')[0]!;
    const problems: string[] = [];
    for (const path of paths)
      for (const width of WIDTHS) problems.push(...(await check(path, width, who, home)));
    assert.deepEqual(problems, []);
  });
}

test('HU-010 through the UI: changing the status asks for confirmation; dismissing it changes nothing', async () => {
  // Its own Chrome: after many navigations a long-lived headless tab dismisses confirm() by itself, before the
  // test can answer it. A fresh browser keeps this test independent of the ones before it.
  const shared = page;
  page = await openBrowser();
  try {
    await confirmationFlow();
  } finally {
    await page.close();
    page = shared;
  }
});

async function confirmationFlow(): Promise<void> {
  await login('secretaria@example.com');
  const changeTo = async (accept: boolean) => {
    page.dialogs(accept);
    await page.goto(`${app}/admin/players/6`);
    await page.until(`document.querySelector('[role=tab]')`);
    await page.eval(
      `[...document.querySelectorAll('[role=tab]')].find((b) => /estatus/i.test(b.textContent)).click()`,
    );
    await page.until(`document.querySelector('select[name=status]')`);
    await page.eval(`(() => {
      const s = document.querySelector('select[name=status]'); s.value = 'BAJA_TEMPORAL'; s.dispatchEvent(new Event('change', { bubbles: true }));
      const r = document.querySelector('input[name=statusReason]'); r.value = 'Viaje familiar'; r.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('button[type=submit]')].find((b) => b.textContent.includes('Cambiar estatus')).click();
    })()`);
    await new Promise((r) => setTimeout(r, 800));
    return page.dialogs(true);
  };
  const asked = await changeTo(false);
  assert.match(asked.join(), /¿Cambiar el estatus de Sofía/, '1) asks for confirmation');
  assert.equal(
    (await t.db.query('SELECT estatus FROM jugadores WHERE id = 6'))[0].estatus,
    'ACTIVO',
    'dismissed: unchanged',
  );
  await changeTo(true);
  await page.until(`document.querySelector('[role=status], .alert')`);
  assert.equal(
    (await t.db.query('SELECT estatus FROM jugadores WHERE id = 6'))[0].estatus,
    'BAJA_TEMPORAL',
  );
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM historial_estatus WHERE jugador_id = 6 AND motivo = 'Viaje familiar'",
    ),
    1,
  );
  assert.deepEqual(page.errors(), []);
}

test('persistence: a player created and edited in the UI survives a page reload and an API restart', async () => {
  await login('secretaria@example.com');
  const fill = (fields: Record<string, string>) =>
    page.eval(`(() => {
      const f = ${JSON.stringify(fields)};
      for (const [name, value] of Object.entries(f)) {
        const i = document.querySelector('[formcontrolname=' + name + ']');
        i.value = value;
        i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
      document.querySelector('form button[type=submit]').click();
    })()`);
  await page.goto(`${app}/admin/players/new`);
  await page.until(`document.querySelector('[formcontrolname=firstName]')`);
  await fill({ firstName: 'Persiste', lastName1: 'Recarga', birthDate: '2016-08-08' });
  await page.until(`/^\\/admin\\/players\\/\\d+$/.test(location.pathname)`);
  const id = Number((await page.eval<string>('location.pathname')).split('/').pop());
  const stored = async () =>
    (await t.db.query('SELECT nombre, telefono FROM jugadores WHERE id = ?', [id]))[0];
  assert.deepEqual(
    { ...(await stored()) },
    { nombre: 'Persiste', telefono: null },
    '1) created in MariaDB',
  );

  await page.goto(`${app}/admin/players/${id}`);
  await page.until(settled);
  assert.match(
    await page.eval<string>(`document.querySelector('main').innerText`),
    /Persiste Recarga/,
    '2) after a reload',
  );

  await page.goto(`${app}/admin/players/${id}/edit`);
  await page.until(
    `document.querySelector('[formcontrolname=phone]')?.value !== undefined && document.querySelector('[formcontrolname=firstName]').value === 'Persiste'`,
  );
  await fill({ phone: '5512345678' });
  await page.until(`location.pathname === '/admin/players/${id}'`);
  assert.equal((await stored()).telefono, '5512345678', '3) the edit is stored');

  // 4) A new API process: its own pool and an empty memory, same MariaDB. The session cookie is still valid.
  const pool = createPool({ ...process.env, DB_NAME: t.name });
  const restarted = createApp(pool, { secureCookie: false }).listen(0);
  await new Promise((resolve) => restarted.once('listening', resolve));
  const previous = apiBase;
  apiBase = `http://127.0.0.1:${(restarted.address() as AddressInfo).port}`;
  try {
    await page.goto(`${app}/admin/players/${id}`);
    await page.until(settled);
    const text = await page.eval<string>(`document.querySelector('main').innerText`);
    assert.match(text, /Persiste Recarga/);
    assert.match(text, /5512345678/);
  } finally {
    apiBase = previous;
    restarted.close();
    await pool.end();
  }
  assert.deepEqual(page.errors(), []);
});
