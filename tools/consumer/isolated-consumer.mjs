import { copyFile, cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sharedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = '@aihq', copied = 'catalog';

// Per-file copies run in parallel; a sequential recursive cp of the Catalog takes seconds longer on Windows.
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  await Promise.all((await readdir(from, { withFileTypes: true })).map(entry => entry.isDirectory()
    ? copyTree(join(from, entry.name), join(to, entry.name)) : copyFile(join(from, entry.name), join(to, entry.name))));
}

// A disposable consumer whose installed Catalog is a real copy; every other
// installed package is linked, so tests may rewrite the copy but never the
// shared install. The Catalog reader refuses linked members, hence the copy.
export async function isolatedConsumer() {
  const root = await mkdtemp(join(tmpdir(), 'aih-isolated-consumer-'));
  const dispose = () => rm(root, { recursive: true, force: true });
  try {
    await cp(join(sharedRoot, 'consumer'), join(root, 'consumer'), { recursive: true });
    await cp(join(sharedRoot, 'package.json'), join(root, 'package.json'));
    const shared = join(sharedRoot, 'node_modules'), modules = join(root, 'node_modules');
    const link = (name) => symlink(join(shared, name), join(modules, name), process.platform === 'win32' ? 'junction' : 'dir');
    await mkdir(join(modules, scope), { recursive: true });
    for (const entry of await readdir(shared, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== scope && entry.name !== '.bin') await link(entry.name);
    }
    for (const entry of await readdir(join(shared, scope))) {
      if (entry === copied) await copyTree(join(shared, scope, entry), join(modules, scope, entry));
      else await link(join(scope, entry));
    }
  } catch (error) { await dispose(); throw error; }
  return {
    root,
    catalogManifest: join(root, 'node_modules', scope, copied, 'package.json'),
    serverUrl: pathToFileURL(join(root, 'consumer', 'server.mjs')).href,
    dispose
  };
}
