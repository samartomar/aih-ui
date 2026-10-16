// One disposable account home as environment variables, in the layout of readiness-fixture.mjs. Core keeps its
// ownership records, recovery manifests, snapshots and run history under the current account's `~/.aih/core`, so a
// process that runs Core against fixtures is given this instead of the developer's real home.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function homeEnvironment(home) {
  const layout = { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache') };
  for (const directory of Object.values(layout)) mkdirSync(directory, { recursive: true });
  return layout;
}
