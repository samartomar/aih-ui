import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createAuthoringAdapter, journalFrictionEvidence } from '../server/authoring.mjs';
import { createReadinessAdapter } from '../server/readiness.mjs';

// The Workbench's own readiness journal is the friction input for checks the person triggered. It lives in the readiness child's memory only, so a child that
// has not started holds none, and the evidence is never labelled fixture: only the demo file is.
async function withConsumer(limit, run) {
  const dir = await mkdtemp(join(tmpdir(), 'aih-friction-journal-'));
  try {
    await mkdir(join(dir, 'consumer'));
    await writeFile(join(dir, 'consumer', 'friction.mjs'), `export const MAX_EVIDENCE = ${limit};\n`);
    await run(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const journal = count => Array.from({ length: count }, (_, index) => ({ schema: 'urn:aih-ui:readiness-record:1.0.0', id: `rec-${index}`, kind: 'machine-check', capturedAt: '2026-10-10T09:00:00.000Z', sha256: String(index % 10).repeat(64), check: { items: [] } }));

test('each journal record becomes one stored result with its own id, instant and digest, and no fixture flag', async () => {
  await withConsumer(256, async dir => {
    const records = journal(3), read = await journalFrictionEvidence(dir, async () => records);
    const evidence = await read();
    assert.deepEqual(evidence, records.map(record => ({ id: record.id, capturedAt: record.capturedAt, sha256: record.sha256, result: record })));
    assert.equal(evidence.some(entry => 'fixture' in entry), false);
    assert.equal(evidence[0].result, records[0], 'the record is the stored result as it is; nothing is copied out of it');
  });
});

test('an empty journal or one the host does not hold is undefined; an unreadable one is null; neither is an empty list', async () => {
  await withConsumer(256, async dir => {
    const answer = source => journalFrictionEvidence(dir, source).then(read => read());
    assert.equal(await answer(async () => undefined), undefined);
    assert.equal(await answer(async () => []), undefined);
    assert.equal(await answer(async () => null), null);
    assert.equal(await answer(async () => { throw new Error('child failed'); }), null);
    assert.equal(await answer(() => { throw new Error('sync failure'); }), null);
    for (const odd of ['x', {}, 5, [null], [1], [[]], ['x']]) assert.equal(await answer(async () => odd), null, JSON.stringify(odd));
  });
});

test('the journal is bounded by the consumer directory\'s MAX_EVIDENCE, whatever its value, and is read afresh each time', async () => {
  await withConsumer(3, async dir => {
    assert.equal((await (await journalFrictionEvidence(dir, async () => journal(3)))()).length, 3);
    assert.equal(await (await journalFrictionEvidence(dir, async () => journal(4)))(), null);
  });
  await withConsumer(300, async dir => {
    let reads = 0, held = journal(1);
    const read = await journalFrictionEvidence(dir, async () => { reads += 1; return held; });
    assert.equal((await read()).length, 1);
    held = journal(2);
    assert.equal((await read()).length, 2);
    assert.equal(reads, 2);
  });
});

// The adapter hands the consumer host one friction provider: the demo file when AIH_FRICTION_EVIDENCE is set, else the journal's. A stand-in consumer host keeps the
// options it is started with, so the choice is observed where the real host takes it. `inspect` runs before the directory is removed.
async function withStartedOptions({ demo, provider }, inspect) {
  const dir = await mkdtemp(join(tmpdir(), 'aih-friction-choice-')), saved = process.env.AIH_FRICTION_EVIDENCE;
  try {
    await mkdir(join(dir, 'consumer'));
    await writeFile(join(dir, 'consumer', 'friction.mjs'), 'export const MAX_EVIDENCE = 8;\n');
    await writeFile(join(dir, 'consumer', 'server.mjs'), `export async function startConsumer(options) { globalThis.aihStartedWith = options; return { origin: 'http://127.0.0.1:1', server: { close() {} } }; }\n`);
    if (demo) { await writeFile(join(dir, 'demo.json'), JSON.stringify({ entries: [{ id: 'demo-1', capturedAt: '2026-10-10T09:00:00Z', result: { n: 1 } }] })); process.env.AIH_FRICTION_EVIDENCE = join(dir, 'demo.json'); }
    else delete process.env.AIH_FRICTION_EVIDENCE;
    await createAuthoringAdapter(dir, provider ? { frictionEvidence: await journalFrictionEvidence(dir, provider) } : {});
    await inspect(globalThis.aihStartedWith);
  } finally {
    delete globalThis.aihStartedWith;
    if (saved === undefined) delete process.env.AIH_FRICTION_EVIDENCE; else process.env.AIH_FRICTION_EVIDENCE = saved;
    await rm(dir, { recursive: true, force: true });
  }
}

test('with AIH_FRICTION_EVIDENCE set the demo file is the evidence, labelled fixture, and the journal is not read', async () => {
  let asked = 0;
  await withStartedOptions({ demo: true, provider: async () => { asked += 1; return journal(1); } }, async options => {
    const entries = await options.frictionEvidence();
    assert.deepEqual(entries.map(entry => [entry.id, entry.fixture]), [['demo-1', true]]);
    assert.equal(asked, 0);
  });
});

test('without it the journal is the evidence, unlabelled and read afresh; with no provider the host is given none', async () => {
  let asked = 0;
  await withStartedOptions({ provider: async () => { asked += 1; return journal(2); } }, async options => {
    const entries = await options.frictionEvidence();
    assert.deepEqual(entries.map(entry => entry.id), ['rec-0', 'rec-1']); assert.equal(entries.some(entry => 'fixture' in entry), false);
    await options.frictionEvidence();
    assert.equal(asked, 2);
  });
  await withStartedOptions({}, async options => assert.equal('frictionEvidence' in options, false));
});

// A child that records each start and answers what the test asks, in place of Core, so the adapter's own behaviour is what is observed. `records` is what it answers
// to the journal request and `exit` makes it stop on that request; both are set for the child only while `run` does, and the earlier values come back after.
async function withFakeChild({ records, exit } = {}, run) {
  const dir = await mkdtemp(join(tmpdir(), 'aih-readiness-journal-')), marker = join(dir, 'starts.txt');
  await mkdir(join(dir, 'consumer'));
  await writeFile(join(dir, 'consumer', 'readiness-child.mjs'), `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, 'started\\n');
const answers = { repairs: { status: 'ok', value: { repairs: [] } }, records: JSON.parse(process.env.FAKE_RECORDS ?? 'null') };
process.on('message', ({ id, op }) => {
  if (op === 'records' && process.env.FAKE_EXIT === 'records') process.exit(0);
  process.send({ id, result: answers[op] });
});
process.on('disconnect', () => process.exit(0));
`);
  const saved = { FAKE_RECORDS: process.env.FAKE_RECORDS, FAKE_EXIT: process.env.FAKE_EXIT };
  for (const [name, value] of [['FAKE_RECORDS', records === undefined ? undefined : JSON.stringify(records)], ['FAKE_EXIT', exit]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  const adapter = createReadinessAdapter(dir);
  const startsOf = async () => existsSync(marker) ? (await readFile(marker, 'utf8')).split('\n').filter(Boolean).length : 0;
  const start = async () => {
    const request = { method: 'GET', headers: { host: '127.0.0.1:4999' }, socket: { localPort: 4999 } }, response = { writeHead() { return this; }, end() {} };
    assert.equal(await adapter.handle(request, response, '/api/readiness-repairs'), true);
  };
  try { await run({ adapter, start, startsOf }); }
  finally {
    adapter.close();
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    // The stopped child may still hold its working directory for a moment on Windows.
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

test('the adapter answers undefined without starting the child, then the child\'s journal once it has started', async () => {
  const records = journal(2);
  await withFakeChild({ records }, async ({ adapter, start, startsOf }) => {
    assert.equal(await adapter.records(), undefined);
    await wait(400);
    assert.equal(await startsOf(), 0, 'asking for the journal must not fork the readiness child');
    await start();
    assert.equal(await startsOf(), 1);
    assert.deepEqual(await adapter.records(), records);
    assert.equal(await startsOf(), 1, 'reading the journal reuses the running child');
    adapter.close();
    assert.equal(await adapter.records(), undefined, 'a closed host holds no journal');
    await wait(200);
    assert.equal(await startsOf(), 1);
  });
});

test('a child that answers something other than a list, or stops while asked, is unreadable (null), never an empty journal', async () => {
  const refused = { status: 'error', diagnostics: [{ code: 'READINESS_CONFIG_INVALID' }] };
  await withFakeChild({ records: refused }, async ({ adapter, start }) => { await start(); assert.equal(await adapter.records(), null); });
  await withFakeChild({ records: journal(1), exit: 'records' }, async ({ adapter, start }) => { await start(); assert.equal(await adapter.records(), null); });
});

test('the journal is not an HTTP route: the page cannot read it', async () => {
  const source = await readFile(new URL('../server/readiness.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'\/api\/readiness-records'/);
  await withFakeChild({}, async ({ adapter, startsOf }) => {
    const request = { method: 'GET', headers: { host: '127.0.0.1:4999' }, socket: { localPort: 4999 } }, seen = [];
    const response = { writeHead(code) { seen.push(code); return this; }, end() {} };
    assert.equal(await adapter.handle(request, response, '/api/readiness-records'), true);
    assert.deepEqual(seen, [404]);
    assert.equal(await startsOf(), 0);
  });
});
