/**
 * deploy/mariadb/respaldo-programado.sh (IND3-01, IND3-02; audit of 93a16d2: IND4-03, IND4-04, IND4-05). Runs the real
 * script with a fake `mariadb-dump` and a fake `gpg` first in PATH: no database and no key are touched.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'deploy/mariadb/respaldo-programado.sh';
/** Everything these tests write (fake data only), removed at the end. */
const ROOT = mkdtempSync(join(tmpdir(), 'respaldo-prueba-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const EVENT =
  '/*!50106 CREATE*/ /*!50106 EVENT `ev_cargos_vencidos` ON SCHEDULE EVERY 1 DAY DO CALL marcar_cargos_vencidos() */ ;;';
const PROCEDURE = 'CREATE DEFINER=`app`@`localhost` PROCEDURE `marcar_cargos_vencidos`()';
const DATA_WITH_THE_TEXT =
  "INSERT INTO `auditoria` VALUES (1,'nota','CREATE PROCEDURE `marcar_cargos_vencidos`() copiado en un dato');";

/** A PATH with a fake mariadb-dump that prints `body` (after `sleep` seconds) and a gpg that copies its input. */
function fakes(body: string[], sleep = 0): string {
  const bin = mkdtempSync(join(ROOT, 'respaldo-bin-'));
  const dump = join(bin, 'mariadb-dump');
  writeFileSync(
    dump,
    `#!/bin/sh\n${sleep ? `sleep ${sleep}\n` : ''}cat <<'FIN'\n${[...body, '-- Dump completed on 2026-11-05'].join('\n')}\nFIN\n`,
  );
  const gpg = join(bin, 'gpg');
  writeFileSync(
    gpg,
    '#!/bin/sh\nwhile [ $# -gt 1 ]; do case "$1" in --output) OUT="$2"; shift;; esac; shift; done\ncp "$1" "$OUT"\n',
  );
  chmodSync(dump, 0o755);
  chmodSync(gpg, 0o755);
  return bin;
}
const env = (bin: string) => ({
  ...process.env,
  PATH: `${bin}:${process.env['PATH']}`,
  BACKUP_GPG_RECIPIENT: 'prueba@example.com',
});
/** Every file left under `dir`, recursively (hidden ones too). */
const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));

test('a dump with the procedure is encrypted and nothing in clear is left', () => {
  const dir = mkdtempSync(join(ROOT, 'respaldo-ok-'));
  const run = spawnSync('sh', [SCRIPT, 'ef_falsa', dir], {
    env: env(fakes([EVENT, PROCEDURE])),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const left = files(dir);
  assert.equal(left.length, 1, left.join(', '));
  assert.match(left[0]!, /diario\/ef_falsa_.*\.sql\.gz\.gpg$/);
});

for (const [why, body] of [
  ['only the EVENT names it (IND3-01)', [EVENT]],
  ['the text is in the data, not a routine (IND4-03)', [EVENT, DATA_WITH_THE_TEXT]],
] as const)
  test(`a dump without the procedure fails: ${why}`, () => {
    const dir = mkdtempSync(join(ROOT, 'respaldo-sin-'));
    const run = spawnSync('sh', [SCRIPT, 'ef_falsa', dir], {
      env: env(fakes([...body])),
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no contiene el procedimiento/);
    assert.deepEqual(files(dir), [], 'no backup and nothing in clear');
  });

// dash (Debian's /bin/sh) skips the EXIT trap on a signal, unlike bash: both are checked when installed.
const SHELLS = ['sh', ...(spawnSync('sh', ['-c', 'command -v dash']).status === 0 ? ['dash'] : [])];
for (const shell of SHELLS)
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const)
    test(`${shell}: ${signal} during the dump leaves nothing in clear (IND3-02, IND4-05)`, async () => {
      const dir = mkdtempSync(join(ROOT, 'respaldo-senal-'));
      const child = spawn(shell, [SCRIPT, 'ef_falsa', dir], {
        env: env(fakes([EVENT, PROCEDURE], 2)),
        detached: true, // its own process group: the signal reaches the script and the dump, as a timer would
        stdio: 'ignore',
      });
      await new Promise((r) => setTimeout(r, 500));
      process.kill(-child.pid!, signal);
      const code = await new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
      assert.notEqual(code, 0);
      assert.deepEqual(files(dir), []);
    });

test('what a killed run left (KILL can not be trapped) is removed by the next one', () => {
  const dir = mkdtempSync(join(ROOT, 'respaldo-kill-'));
  const stale = join(dir, '.trabajo.viejo');
  spawnSync('mkdir', ['-p', stale]);
  writeFileSync(join(stale, 'volcado.sql.gz'), 'en claro');
  spawnSync('touch', ['-t', '202601010000', stale]);
  const run = spawnSync('sh', [SCRIPT, 'ef_falsa', dir], {
    env: env(fakes([EVENT, PROCEDURE])),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(
    files(dir).every((f) => f.endsWith('.gpg')),
    files(dir).join(', '),
  );
});
