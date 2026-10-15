// Controlled machine-readiness fixture: a disposable home, a PATH directory with
// one deliberately broken tool and a test-only CA certificate. Tests and demos
// pass `env` to the readiness host process so Core observes and repairs only
// these directories, never the developer's real clients or configuration.
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_CA = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'readiness-ca.pem');

// `jq` exits unsuccessfully for its version command, so Core reports a failed check.
function writeBrokenTool(bin) {
  if (process.platform === 'win32') {
    copyFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'findstr.exe'), join(bin, 'jq.exe'));
  } else {
    writeFileSync(join(bin, 'jq'), '#!/bin/sh\nexit 3\n');
    chmodSync(join(bin, 'jq'), 0o755);
  }
}

export function createReadinessFixture(root) {
  const home = join(root, 'home'), bin = join(root, 'bin');
  for (const directory of [home, bin, join(home, 'AppData', 'Local'), join(home, 'AppData', 'Roaming'), join(home, '.config'),
    join(home, '.local', 'state'), join(home, '.local', 'share'), join(home, '.cache')]) mkdirSync(directory, { recursive: true });
  writeBrokenTool(bin);
  const system = process.platform === 'win32' ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'];
  const path = [bin, dirname(process.execPath), ...system].join(delimiter);
  const env = { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'), PATH: path };
  return { root, home, bin, path, caFile: FIXTURE_CA, env };
}
