// Child-process entry for the reviewed-batch host. The parent server forks this with a disposable account home in its
// environment, because Core keeps ownership records, recovery manifests, snapshots and run history under the current
// account's `~/.aih/core`. It talks to the parent only over Node IPC: { id, op, body } in, { id, result } out, where a
// failure is a result of its own ({ status: 'error', diagnostics }). Envelope bytes cross as base64, since the IPC channel
// is JSON. Nothing here is built from a request. The envelope file's path is host configuration in the environment; with it the
// child persists the superseding batch that spends a Run again choice, with the parent's atomic replace, before a process runs.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createBatchHost } from './batch-host.mjs';
import { replaceEnvelope } from './envelope-file.mjs';

const same = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const operations = { review: 'reviewBatch', run: 'runBatch', recover: 'recoverBatch' };
const failure = (code, message) => ({ status: 'error', diagnostics: [{ code, message }] });

async function perform(op, { envelope, batchId, approve, rerun, now, clients, materialRoots, faults }) {
  // The parent names the home it chose; a child that resolves any other home refuses to touch Core at all.
  if (!process.env.AIH_BATCH_CORE_HOME || !same(homedir(), process.env.AIH_BATCH_CORE_HOME)) return failure('BATCH_HOME_INVALID', 'The batch host is not running in the isolated Core home.');
  const host = createBatchHost({ clients, materialRoots, controls: { logging: 'off' }, faults });
  const path = process.env.AIH_BATCH_ENVELOPE, persist = path ? bytes => replaceEnvelope(path, bytes) : undefined;
  try {
    const result = await host[operations[op]]({ envelopeBytes: new Uint8Array(Buffer.from(envelope, 'base64')), batchId, approve, rerun, now, persist });
    // A refusal's `originalBytes` is the envelope the parent already holds; neither it nor the bytes themselves belong in the answer.
    const { envelopeBytes, originalBytes: _held, ...rest } = result;
    return envelopeBytes ? { ...rest, envelope: Buffer.from(envelopeBytes).toString('base64') } : rest;
  } finally { await host.close?.(); }
}

process.on('message', async ({ id, op, body } = {}) => {
  let result;
  try {
    result = Object.hasOwn(operations, op) ? await perform(op, body) : failure('BATCH_HOST_FAILURE', `Unknown batch operation ${String(op)}`);
  } catch (error) {
    result = failure('BATCH_HOST_FAILURE', error.message);
  }
  process.send({ id, result });
});
process.on('disconnect', () => process.exit(0));
