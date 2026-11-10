import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  SCRYPT_PARAMETERS,
  verifyPassword,
  type ScryptParameters,
} from './passwords.ts';

test('scrypt hashes identify their algorithm and parameters, verify the right password, and reject a wrong one', async () => {
  const stored = await hashPassword('correct horse 42');
  assert.match(stored, /^\$scrypt\$v=1\$N=32768,r=8,p=1,l=64\$/);
  assert.equal(await verifyPassword('correct horse 42', stored), true);
  assert.equal(await verifyPassword('wrong password 42', stored), false);
});

test('equal passwords receive independent random salts', async () => {
  const first = await hashPassword('same password 42');
  const second = await hashPassword('same password 42');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('same password 42', first), true);
  assert.equal(await verifyPassword('same password 42', second), true);
});

test('malformed, truncated, and legacy-format hashes fail closed', async () => {
  for (const value of [
    '',
    'legacy-format',
    '$scrypt$v=1$N=32768,r=8,p=1,l=64$bad',
    '$scrypt$v=99$...',
    '$scrypt$v=1$N=999999999999,r=8,p=1,l=64$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$scrypt$v=1$N=32768,r=999,p=1,l=64$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ])
    assert.equal(await verifyPassword('some password 42', value), false);
});

test('invalid scrypt parameters are rejected before hashing', async () => {
  const bad = { ...SCRYPT_PARAMETERS, N: 12 } as ScryptParameters;
  await assert.rejects(hashPassword('some password 42', bad), /Invalid scrypt parameters/);
  await assert.rejects(hashPassword('', SCRYPT_PARAMETERS), /Invalid password input/);
});
