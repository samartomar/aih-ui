// Child-process entry for the reviewed-batch host. The parent server forks this with a disposable account home in its
// environment, because Core keeps ownership records, recovery manifests, snapshots and run history under the current
// account's `~/.aih/core`. It talks to the parent only over Node IPC: { id, op, body } in, { id, result | error } out.
// Envelope bytes cross as base64, since the IPC channel is JSON. Nothing here is built from a request.
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createBatchHost } from './batch-host.mjs';

const same = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const operations = { review: 'reviewBatch', run: 'runBatch', recover: 'recoverBatch' };

async function perform(op, { envelope, batchId, approve, now, clients, materialRoots, faults }) {
  // The parent names the home it chose; a child that resolves any other home refuses to touch Core at all.
  if (!process.env.AIH_BATCH_CORE_HOME || !same(homedir(), process.env.AIH_BATCH_CORE_HOME)) throw new Error('The batch host is not running in the isolated Core home.');
  const host = createBatchHost({ clients, materialRoots, controls: { logging: 'off' }, faults });
  try {
    const result = await host[operations[op]]({ envelopeBytes: new Uint8Array(Buffer.from(envelope, 'base64')), batchId, approve, now });
    const { envelopeBytes, ...rest } = result;
    return envelopeBytes ? { ...rest, envelope: Buffer.from(envelopeBytes).toString('base64') } : rest;
  } finally { await host.close?.(); }
}

process.on('message', async ({ id, op, body } = {}) => {
  try {
    if (!Object.hasOwn(operations, op)) throw new Error(`Unknown batch operation ${String(op)}`);
    process.send({ id, result: await perform(op, body) });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
process.on('disconnect', () => process.exit(0));
