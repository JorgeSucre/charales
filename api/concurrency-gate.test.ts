import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { concurrencyGate } from './concurrency-gate.ts';
import { runScryptOperation, ScryptOperationError } from './scrypt-gate.ts';

test('the per-session request gate caps active work and hands a released slot to the oldest waiter', async () => {
  const gate = concurrencyGate({ limit: 1, waitMs: 1_000 });
  const releaseFirst = await gate.acquire();
  const waiting = gate.acquire();
  assert.deepEqual(gate.stats(), { active: 1, waiting: 1 });
  releaseFirst!();
  const releaseSecond = await waiting;
  assert.ok(releaseSecond);
  assert.deepEqual(gate.stats(), { active: 1, waiting: 0 });
  releaseSecond();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('a full gate refuses immediately and releases slots when work throws', async () => {
  const gate = concurrencyGate({ limit: 1, waitMs: 0 });
  const release = await gate.acquire();
  assert.equal(await gate.acquire(), null);
  release!();
  await assert.rejects(
    gate.run(async () => {
      throw new Error('expected');
    }),
    /expected/,
  );
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

test('concurrency gate enforces its active limit and admits queued work in order', async () => {
  const gate = concurrencyGate({ limit: 1, maxWaiters: 2, waitMs: 500 });
  const held = deferred<void>();
  const first = gate.run(async () => held.promise);
  await new Promise((resolve) => setImmediate(resolve));
  const order: number[] = [];
  const second = gate.run(async () => void order.push(2));
  const third = gate.run(async () => void order.push(3));
  assert.deepEqual(gate.stats(), { active: 1, waiting: 2 });
  held.resolve();
  assert.deepEqual(await first, { busy: false, value: undefined });
  await Promise.all([second, third]);
  assert.deepEqual(order, [2, 3]);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('concurrency gate rejects a full queue and times out a waiter', async () => {
  const gate = concurrencyGate({ limit: 1, maxWaiters: 1, waitMs: 20 });
  const held = deferred<void>();
  const first = gate.run(async () => held.promise);
  await new Promise((resolve) => setImmediate(resolve));
  const queued = gate.run(async () => 'admitted');
  assert.deepEqual(await gate.run(async () => 'never'), { busy: true });
  assert.deepEqual(await queued, { busy: true });
  held.resolve();
  await first;
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('concurrency gate releases its slot after rejected work', async () => {
  const gate = concurrencyGate({ limit: 1, maxWaiters: 1, waitMs: 100 });
  await assert.rejects(
    gate.run(async () => Promise.reject(new Error('expected'))),
    /expected/,
  );
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
  assert.deepEqual(await gate.run(async () => 'available'), { busy: false, value: 'available' });
});

test('scrypt gate configuration has bounded defaults and rejects unsafe settings', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = `import { SCRYPT_GATE_LIMITS } from './api/scrypt-gate.ts'; console.log(JSON.stringify(SCRYPT_GATE_LIMITS));`;
  const cleanEnv = { ...process.env };
  delete cleanEnv['SCRYPT_MAX_CONCURRENT'];
  delete cleanEnv['SCRYPT_MAX_WAITERS'];
  delete cleanEnv['SCRYPT_WAIT_MS'];
  const defaults = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: cleanEnv,
    encoding: 'utf8',
  });
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout), { maxConcurrent: 2, maxWaiters: 32, waitMs: 5000 });

  const invalid = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: { ...cleanEnv, SCRYPT_MAX_CONCURRENT: '17' },
    encoding: 'utf8',
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /SCRYPT_MAX_CONCURRENT must be between 1 and 16/);
});

test('native scrypt failures become a safe operational error and release capacity', async () => {
  await assert.rejects(
    runScryptOperation(async () => Promise.reject(new Error('native error detail'))),
    (error: unknown) => {
      assert.ok(error instanceof ScryptOperationError);
      assert.equal(error.message, 'Scrypt operation failed.');
      assert.ok(!error.message.includes('native error detail'));
      return true;
    },
  );
  assert.equal(await runScryptOperation(async () => 'slot released'), 'slot released');
});

test('the process scrypt gate rejects work when its configured global capacity is exhausted', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = `
    import { withScryptCapacity } from './api/scrypt-gate.ts';
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const first = withScryptCapacity(() => held);
    await new Promise(setImmediate);
    try {
      await withScryptCapacity(async () => 'should not run');
      process.exitCode = 2;
    } catch (error) {
      console.log(error.name);
    } finally {
      release();
      await first;
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: { ...process.env, SCRYPT_MAX_CONCURRENT: '1', SCRYPT_MAX_WAITERS: '0' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ScryptCapacityError');
});
