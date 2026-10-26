// Child-process entry for the reviewed-batch host. The parent server forks this with a disposable account home in its
// environment, because Core keeps ownership records, recovery manifests, snapshots and run history under the current
// account's published state location. It talks to the parent only over Node IPC: { id, op, body } in, { id, result } out, where a
// failure is a result of its own ({ status: 'error', diagnostics }). Envelope bytes cross as base64, since the IPC channel
// is JSON. Nothing here is built from a request, and the child never writes the envelope file: the parent is its one writer. To
// record each attempt at a process (its first, or a Run again) before the process runs, `persist` asks the parent over the same
// channel, { id, persist, expectedRevisionSha256 } out and { id, persisted } back (`persisted: false` carries the error `code`),
// and the parent replaces the file as a compare-and-swap on the stored revision (see envelope-file). A parent that cannot be
// reached makes `persist` throw, so the process does not run.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createBatchHost } from './batch-host.mjs';

const same = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const operations = { review: 'reviewBatch', run: 'runBatch', recover: 'recoverBatch' };
const failure = (code, message) => ({ status: 'error', diagnostics: [{ code, message }] });
const asking = new Map();
let asked = 0;
const lost = () => { for (const [id, ask] of asking) { asking.delete(id); ask.reject(Object.assign(new Error('The batch host lost its parent.'), { code: 'BATCH_PARENT_UNREACHABLE' })); } };

// Asks the parent to replace the envelope file, and settles with its answer.
const persist = (bytes, { expectedRevisionSha256 }) => new Promise((resolveAsk, reject) => {
  const id = `persist-${++asked}`;
  if (!process.connected) return reject(Object.assign(new Error('The batch host lost its parent.'), { code: 'BATCH_PARENT_UNREACHABLE' }));
  asking.set(id, { resolve: resolveAsk, reject });
  process.send({ id, persist: Buffer.from(bytes).toString('base64'), expectedRevisionSha256 }, error => { if (error && asking.delete(id)) reject(error); });
});

async function perform(op, { envelope, batchId, approve, rerun, rerunRevision, now, clients, materialRoots, faults }) {
  // The parent names the home it chose; a child that resolves any other home refuses to touch Core at all.
  if (!process.env.AIH_BATCH_CORE_HOME || !same(homedir(), process.env.AIH_BATCH_CORE_HOME)) return failure('BATCH_HOME_INVALID', 'The batch host is not running in the isolated Core home.');
  const host = createBatchHost({ clients, materialRoots, controls: { logging: 'off' }, faults });
  try {
    const result = await host[operations[op]]({ envelopeBytes: new Uint8Array(Buffer.from(envelope, 'base64')), batchId, approve, rerun, rerunRevision, now, persist });
    // A refusal's `originalBytes` is the envelope the parent already holds; neither it nor the bytes themselves belong in the answer.
    const { envelopeBytes, originalBytes: _held, ...rest } = result;
    return envelopeBytes ? { ...rest, envelope: Buffer.from(envelopeBytes).toString('base64') } : rest;
  } finally { await host.close?.(); }
}

process.on('message', async message => {
  const { id, op, body } = message ?? {};
  if (asking.has(id)) {
    const ask = asking.get(id); asking.delete(id);
    if (message.persisted === true) ask.resolve(); else ask.reject(Object.assign(new Error('The parent did not save the batch.'), { code: message.code ?? 'persist-failed' }));
    return;
  }
  let result;
  try {
    result = Object.hasOwn(operations, op) ? await perform(op, body) : failure('BATCH_HOST_FAILURE', `Unknown batch operation ${String(op)}`);
  } catch (error) {
    result = failure('BATCH_HOST_FAILURE', error.message);
  }
  process.send({ id, result });
});
process.on('disconnect', () => { lost(); process.exit(0); });
