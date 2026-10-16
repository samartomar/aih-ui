// The candidate never takes the ordinary preview's port (4173) or a port something else holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { assertPortAvailable } from '../candidate/port.mjs';

const listening = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closed = server => new Promise(resolve => server.close(resolve));
const refused = code => error => { assert.equal(error.code, code); return true; };

test('4173, the ordinary preview\'s port, is refused whether or not anything listens on it', async () => {
  await assert.rejects(assertPortAvailable(4173), error => { assert.equal(error.code, 'CANDIDATE_PORT_RESERVED'); assert.match(error.message, /4173 is reserved for the ordinary preview/); return true; });
});

test('a port already in use is refused, and is free again once released', async () => {
  const holder = createServer(), port = await listening(holder);
  await assert.rejects(assertPortAvailable(port), refused('CANDIDATE_PORT_IN_USE'));
  await closed(holder);
  await assertPortAvailable(port);
});

test('a free port is accepted and left free', async () => {
  const probe = createServer(), port = await listening(probe);
  await closed(probe);
  await assertPortAvailable(port);
  const again = createServer();
  await new Promise((resolve, reject) => again.once('error', reject).listen(port, '127.0.0.1', resolve));
  await closed(again);
});

test('anything that is not a port number is refused', async () => {
  for (const port of [0, -1, 65536, 4300.5, NaN, '4300', undefined]) await assert.rejects(assertPortAvailable(port), refused('CANDIDATE_PORT_INVALID'), String(port));
});
