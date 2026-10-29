// Owned workbench host for the UI165/UI168 process-restart acceptance cases. This entry exists ONLY so the
// checker can run the Workbench server in a real child Node process: the parent kills and reaps it between
// phases and starts a fresh process on the same target, account home and settings. An in-process
// server.close() + recreate is not a process restart and is never described as one here.
//
// Usage: node tools/installed-host.mjs <config.json>
//   { consumerDir, runDir, summaryPath, settingsPath, portPath, env: { NAME: value, ... } }
// The chosen port is written to portPath; SIGTERM/SIGINT close the server and exit 0.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createWorkbench } from './server/workbench.mjs';
import { listen } from './server/static.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [key, value] of Object.entries(config.env ?? {})) process.env[key] = value;
const summary = JSON.parse(readFileSync(config.summaryPath, 'utf8'));
let frameworkFixtureInventories, createExecutionHost;
if (config.noteVariant) {
  const { noteInventory } = await import(pathToFileURL(`${config.consumerDir}/consumer/ui168-update-browser.mjs`).href);
  frameworkFixtureInventories = [await noteInventory(config.noteVariant)];
}
if (config.interrupt) {
  const { createHost } = await import(pathToFileURL(`${config.consumerDir}/consumer/host.mjs`).href);
  createExecutionHost = options => {
    const host = createHost(options);
    return { ...host, async applyApproved(input) {
      const result = host.applyApproved(input);
      writeFileSync(`${config.runDir}/../apply-started`, 'Core Apply started');
      await new Promise(done => setTimeout(done, 1000));
      return result;
    } };
  };
}
const workbench = await createWorkbench({ consumerDir: config.consumerDir, runDir: config.runDir, summary, settingsPath: config.settingsPath, frameworkFixtureInventories, createExecutionHost });
const address = await listen(workbench.server, 0);
writeFileSync(config.portPath, String(address.port));
const shutdown = () => workbench.server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
workbench.server.on('close', () => setTimeout(() => process.exit(0), 50).unref());
