// Experimento fuera del repo: mismo flujo que la prueba «user menu» con los chunks retrasados DELAY ms (red lenta).
// Brazo A: espera `settled` como la prueba. Brazo B: además espera a que termine la redirección a /admin/dashboard.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
const W = process.env.W!;
const { openTestDb } = await import(join(W, 'api/test-db.ts'));
const { openBrowser } = await import(join(W, 'e2e/browser.ts'));
const DIST = join(W, 'dist/project/browser');
const DELAY = 300;
const TYPES: any = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
};
let t: any,
  web: any,
  app = '',
  page: any,
  armed = false;
before(async () => {
  t = await openTestDb('ef_s02race', { realClock: true });
  const api = new URL(t.base);
  web = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (/^\/(api|auth|health)(\/|$)/.test(path)) {
      if (armed && path === '/auth/session') {
        const go = () => {
          const up = request(
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
          req.pipe(up);
        };
        setTimeout(go, DELAY);
        return;
      }
      const up = request(
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
      req.pipe(up);
      return;
    }
    const file = join(DIST, path);
    const target = existsSync(file) && extname(file) ? file : join(DIST, 'index.html');
    const send = () => {
      res.writeHead(200, {
        'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(readFileSync(target));
    };
    send();
  }).listen(0);
  await new Promise((r) => web.once('listening', r));
  app = `http://127.0.0.1:${web.address().port}`;
  page = await openBrowser();
  await page.size(1280, 900);
  await page.goto(`${app}/login`);
  await page.until(`document.querySelector('input[type=email]')`);
  await page.eval(`(() => { const set = (s, v) => { const i = document.querySelector(s); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
    set('input[type=email]', 'admin@example.com'); set('input[type=password]', 'demo1234'); document.querySelector('button[type=submit]').click(); })()`);
  await page.until(`!location.pathname.startsWith('/login')`);
});
after(async () => {
  await page?.close();
  web?.close();
  await t?.close();
});
const settled = `document.querySelector('main') && !document.querySelector('[role=status]')?.textContent?.includes('Cargando')`;
const once = async (extra?: string) => {
  armed = true;
  await page.goto(`${app}/`);
  await page.until(settled);
  if (extra) await page.until(extra);
  await page.eval(`document.querySelector('.user-menu summary').click()`);
  await page.until(`document.querySelector('.user-menu').open`);
  await page.eval(`document.querySelector('.user-menu .menu a').focus()`);
  await new Promise((r) => setTimeout(r, DELAY + 200)); // la navegación pendiente termina aquí, si la hay
  const openAtEscape = await page.eval(`document.querySelector('.user-menu').open`);
  await page.eval(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  const back = await page.eval(
    `document.activeElement === document.querySelector('.user-menu summary')`,
  );
  armed = false;
  return { openAtEscape, back };
};
test('brazos', async () => {
  const out: any = { A: [], B: [] };
  for (let i = 0; i < 10; i++) {
    out.A.push(await once());
    out.B.push(
      await once(`location.pathname === '/admin/dashboard' && document.querySelector('main h1')`),
    );
  }
  const sum = (l: any[]) => ({
    n: l.length,
    focoDevuelto: l.filter((x) => x.back).length,
    menuYaCerradoAlEscape: l.filter((x) => !x.openAtEscape).length,
  });
  console.log(
    'RESULT ' + JSON.stringify({ A_settled: sum(out.A), B_tras_redireccion: sum(out.B) }),
  );
});
