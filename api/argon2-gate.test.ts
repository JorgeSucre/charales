/**
 * S-02 · the per-process Argon2id gate on its own (api/argon2-guard.ts), without HTTP nor MariaDB: the cap, the bounded
 * queue, the wait limit, release on exceptions and twice, and admission after a release. The API routes that use it,
 * with real Argon2id runs: api/argon2-guard.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WAITERS, argon2Gate } from './argon2-guard.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const limit of [1, 2, 3])
  test(`gate: limit ${limit} — 10 tasks at once, never more than ${limit} running, all of them run`, async () => {
    const gate = argon2Gate({ limit, waitMs: 5000 });
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        gate.run(async () => {
          peak = Math.max(peak, ++running);
          await sleep(5);
          running--;
          return i;
        }),
      ),
    );
    assert.deepEqual(
      results.map((r) => (r.busy ? 'busy' : r.value)),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    assert.equal(peak, limit);
    assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
  });

test(`gate: a full queue (${MAX_WAITERS} waiting) refuses at once; the waiters get the slot in order`, async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 5000 });
  const held = (await gate.acquire())!;
  const order: number[] = [];
  const waiters = Array.from({ length: MAX_WAITERS }, (_, i) =>
    gate.acquire().then((release) => {
      order.push(i);
      release!();
    }),
  );
  assert.deepEqual(gate.stats(), { active: 1, waiting: MAX_WAITERS });
  const started = performance.now();
  assert.equal(await gate.acquire(), null, 'one more is refused');
  assert.ok(performance.now() - started < 50, 'without waiting');
  held();
  await Promise.all(waiters);
  assert.deepEqual(
    order,
    Array.from({ length: MAX_WAITERS }, (_, i) => i),
  );
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('gate: a wait that runs out answers null after waitMs, and leaves the queue', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 80 });
  const held = (await gate.acquire())!;
  const started = performance.now();
  assert.equal(await gate.acquire(), null);
  assert.ok(performance.now() - started >= 75, 'it waited');
  assert.deepEqual(gate.stats(), { active: 1, waiting: 0 });
  held();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('gate: an exception in the work frees the slot and propagates', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 0 });
  await assert.rejects(
    gate.run(async () => {
      throw new Error('fallo');
    }),
    /fallo/,
  );
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
  assert.deepEqual(await gate.run(async () => 'otra vez'), { busy: false, value: 'otra vez' });
});

test('gate: releasing twice is harmless — the cap is not widened', async () => {
  const gate = argon2Gate({ limit: 2, waitMs: 0 });
  const a = (await gate.acquire())!;
  a();
  a();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
  const b = (await gate.acquire())!;
  const c = (await gate.acquire())!;
  assert.equal(await gate.acquire(), null, 'still only 2');
  b();
  c();
  c();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('gate: a release hands the slot straight to the oldest waiter', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 5000 });
  const held = (await gate.acquire())!;
  const pending = gate.acquire();
  assert.deepEqual(gate.stats(), { active: 1, waiting: 1 });
  held();
  const next = await pending;
  assert.ok(next, 'admitted');
  assert.deepEqual(gate.stats(), { active: 1, waiting: 0 });
  next!();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});
