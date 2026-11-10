import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concurrencyGate } from './concurrency-gate.ts';

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
