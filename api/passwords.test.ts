import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  hashPassword,
  isLegacyPasswordHash,
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
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$a2V5',
    '$scrypt$v=1$N=32768,r=8,p=1,l=64$bad',
    '$scrypt$v=99$...',
    '$scrypt$v=1$N=999999999999,r=8,p=1,l=64$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$scrypt$v=1$N=32768,r=999,p=1,l=64$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ])
    assert.equal(await verifyPassword('some password 42', value), false);
});

test('Argon2 legacy hashes are classified internally without attempting compatibility verification', async () => {
  const argon = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$a2V5';
  assert.equal(isLegacyPasswordHash(argon), true);
  assert.equal(isLegacyPasswordHash('$scrypt$v=1$N=32768,r=8,p=1,l=64$abc.def'), false);
  assert.equal(await verifyPassword('legacy password 42', argon), false);
});

test('invalid scrypt parameters are rejected before hashing', async () => {
  const bad = { ...SCRYPT_PARAMETERS, N: 12 } as ScryptParameters;
  await assert.rejects(hashPassword('some password 42', bad), /Invalid scrypt parameters/);
  await assert.rejects(hashPassword('', SCRYPT_PARAMETERS), /Invalid password input/);
});

test('scrypt environment defaults, accepted ranges, and startup rejection are explicit', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = `import { SCRYPT_PARAMETERS } from './api/passwords.ts'; console.log(JSON.stringify(SCRYPT_PARAMETERS));`;
  const cleanEnv = { ...process.env };
  for (const name of ['SCRYPT_N', 'SCRYPT_R', 'SCRYPT_P', 'SCRYPT_KEY_LENGTH', 'SCRYPT_MAXMEM_MB'])
    delete cleanEnv[name];

  const defaults = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: cleanEnv,
    encoding: 'utf8',
  });
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout), {
    N: 32768,
    r: 8,
    p: 1,
    keyLength: 64,
    maxmem: 64 * 1024 * 1024,
  });

  const valid = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: {
      ...cleanEnv,
      SCRYPT_N: '65536',
      SCRYPT_R: '8',
      SCRYPT_P: '2',
      SCRYPT_KEY_LENGTH: '32',
      SCRYPT_MAXMEM_MB: '70',
    },
    encoding: 'utf8',
  });
  assert.equal(valid.status, 0, valid.stderr);

  for (const [name, value] of [
    ['SCRYPT_N', '50000'],
    ['SCRYPT_R', '9'],
    ['SCRYPT_P', '3'],
    ['SCRYPT_KEY_LENGTH', '31'],
    ['SCRYPT_MAXMEM_MB', '129'],
  ]) {
    const invalid = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: { ...cleanEnv, [name]: value },
      encoding: 'utf8',
    });
    assert.notEqual(invalid.status, 0, `${name}=${value} should stop startup`);
  }
});
