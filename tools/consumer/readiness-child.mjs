// Child-process entry for the machine-readiness host. The parent server forks this so Core
// runs with host-chosen environment, and talks to it only over Node IPC: { id, op, body } in,
// { id, result } out. Optional offerable repairs come from the JSON file named by
// AIH_READINESS_REPAIRS; they are never read from a request.
import { readFileSync } from 'node:fs';
import { createReadinessHost } from './readiness-host.mjs';

let host, startupError;
try {
  const file = process.env.AIH_READINESS_REPAIRS;
  const config = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  host = createReadinessHost({ repairs: config.repairs, staged: config.staged });
} catch (error) {
  // Answer every request with the configuration error instead of crashing into a restart loop.
  startupError = { status: 'error', diagnostics: [{ code: 'READINESS_CONFIG_INVALID', message: `Readiness host configuration is invalid: ${error.message}` }] };
}
const operations = { check: body => host.check(body), repairs: () => host.repairs(), report: () => host.report(),
  'repair-prepare': body => host.prepareRepair(body), 'repair-apply': body => host.applyRepair(body) };

process.on('message', async ({ id, op, body } = {}) => {
  let result;
  try {
    result = startupError ?? (Object.hasOwn(operations, op) ? await operations[op](body)
      : { status: 'error', diagnostics: [{ code: 'INVALID_REQUEST', message: `Unknown readiness operation ${String(op)}` }] });
  } catch (error) {
    result = { status: 'error', diagnostics: [{ code: 'READINESS_HOST_FAILURE', message: error.message }] };
  }
  process.send({ id, result });
});
process.on('disconnect', () => process.exit(0));
