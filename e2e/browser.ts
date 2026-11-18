/**
 * Minimal Chrome DevTools Protocol client for the E2E tests (no extra dependencies): launches the local Chrome
 * headless with a throwaway profile, then navigates, evaluates and takes screenshots. CHROME_PATH overrides the binary.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface Page {
  goto(url: string): Promise<void>;
  eval<T = unknown>(expression: string): Promise<T>;
  /** Waits until `expression` is truthy (polling), or fails after `ms`. */
  until(expression: string, ms?: number): Promise<void>;
  size(width: number, height: number): Promise<void>;
  screenshot(): Promise<Buffer>;
  /** Uncaught exceptions and console.error since the last call. */
  errors(): string[];
  /** How to answer the next confirm() dialogs (accept or dismiss); returns the messages seen so far. */
  dialogs(accept: boolean): string[];
  /** Opt-in: the headless page behaves as focused (document.hasFocus(), :focus-visible). Off by default. */
  focusEmulation(enabled?: boolean): Promise<void>;
  close(): Promise<void>;
}

export const chromeAvailable = () => existsSync(CHROME);

export async function openBrowser(): Promise<Page> {
  const profile = mkdtempSync(join(tmpdir(), 'charales-e2e-'));
  const chrome: ChildProcess = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      // CI runners block Chrome's sandbox; never on a developer machine.
      ...(process.env['CI'] ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets: { type: string; webSocketDebuggerUrl: string }[] = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 1;
  const pending = new Map<
    number,
    (msg: { result?: unknown; error?: { message: string } }) => void
  >();
  const listeners = new Map<string, ((params: Record<string, unknown>) => void)[]>();
  const errors: string[] = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id) pending.get(msg.id)?.(msg);
    else for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = nextId++;
      // A dialog left open blocks the page and Chrome never answers: fail the test instead of hanging the suite.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`CDP ${method}: sin respuesta en 30 s (¿un diálogo abierto en la página?)`),
        );
      }, 30_000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        pending.delete(id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result as Record<string, unknown>);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method: string) =>
    new Promise<void>((resolve) => {
      const list = listeners.get(method) ?? [];
      const fn = () => {
        list.splice(list.indexOf(fn), 1);
        resolve();
      };
      list.push(fn);
      listeners.set(method, list);
    });
  const on = (method: string, fn: (p: Record<string, unknown>) => void) =>
    listeners.set(method, [...(listeners.get(method) ?? []), fn]);

  on('Runtime.exceptionThrown', (p) =>
    errors.push(
      String(
        (p['exceptionDetails'] as { exception?: { description?: string } })?.exception
          ?.description ?? 'exception',
      ),
    ),
  );
  on('Runtime.consoleAPICalled', (p) => {
    if (p['type'] === 'error')
      errors.push(
        (p['args'] as { value?: unknown; description?: string }[])
          .map((a) => a.value ?? a.description)
          .join(' '),
      );
  });
  // A resource the Content-Security-Policy blocked is a page that doesn't work in production.
  on('Log.entryAdded', (p) => {
    const entry = p['entry'] as { source?: string; text?: string };
    if (entry.source === 'security') errors.push(`CSP: ${entry.text}`);
  });
  let acceptDialogs = true;
  const dialogMessages: string[] = [];
  on('Page.javascriptDialogOpening', (p) => {
    dialogMessages.push(String(p['message']));
    // Chrome can refuse an answer sent the very moment the dialog opens («No dialog is showing»): retry briefly,
    // otherwise the dialog stays open and blocks the page.
    const accept = acceptDialogs;
    void (async () => {
      for (let i = 0; i < 20; i++) {
        try {
          await send('Page.handleJavaScriptDialog', { accept });
          return;
        } catch {
          await sleep(50);
        }
      }
    })();
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  const page: Page = {
    async goto(url) {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
    },
    async eval<T>(expression: string) {
      const r = (await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })) as {
        result: { value?: T };
        exceptionDetails?: { text: string };
      };
      if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.text}`);
      return r.result.value as T;
    },
    async until(expression, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        // A navigation in between (Angular redirects) discards the evaluation: just ask again.
        if (await page.eval<boolean>(`!!(${expression})`).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`Timeout esperando: ${expression}`);
    },
    async size(width, height) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
    },
    async screenshot() {
      const r = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
      return Buffer.from(r.data, 'base64');
    },
    errors() {
      return errors.splice(0);
    },
    dialogs(accept) {
      acceptDialogs = accept;
      return dialogMessages.splice(0);
    },
    async focusEmulation(enabled = true) {
      await send('Emulation.setFocusEmulationEnabled', { enabled });
    },
    async close() {
      ws.close();
      chrome.kill();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
  return page;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
