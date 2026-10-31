// The Workbench's hop to its in-process authoring host. A host busy with Core work can close a kept-alive connection
// while the Workbench is about to send on it; the request then fails with a reset. Every request on this hop has its
// own connection, so a connection the host closed is never used again, and nothing is retried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { forward } from '../server/forward.mjs';

// A host that resets any connection a request arrives on after the first: what a kept-alive socket the host closed
// while busy looks like to the next request sent on it.
async function resettingHost(t) {
  const seen = new WeakSet(), bodies = [], reused = [];
  const server = createServer((request, response) => {
    if (seen.has(request.socket)) { reused.push(request.url); request.socket.destroy(); return; }
    seen.add(request.socket);
    let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
    request.on('end', () => { bodies.push(body); response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', n: bodies.length })); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, bodies, reused };
}

test('a kept-alive connection the host closed fails the next request when it is reused', async t => {
  const host = await resettingHost(t);
  // Pooled fetch, as the hop used to be: each answer is read, so its connection goes back to the pool and is reused.
  const failures = [];
  for (let n = 0; n < 5; n++) {
    try { await (await fetch(`${host.origin}/api/authoring-edit`, { method: 'POST', body: '{}' })).text(); }
    catch (error) { failures.push(`${error.message} (${error.cause?.code})`); }
  }
  assert.ok(host.reused.length > 0, 'fetch sent a request on a connection it had used before');
  assert.ok(failures.length > 0 && failures.every(failure => /fetch failed \((ECONNRESET|UND_ERR_SOCKET)\)/.test(failure)), failures.join('; '));
});

test('every request on the hop has its own connection, so none fails on a connection the host closed', async t => {
  const host = await resettingHost(t);
  for (let n = 1; n <= 5; n++) {
    const answer = await forward(`${host.origin}/api/authoring-edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n }) });
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.text), { status: 'ok', n });
  }
  assert.deepEqual(host.bodies, [1, 2, 3, 4, 5].map(n => JSON.stringify({ n })), 'each body reaches the host once');
  assert.deepEqual(host.reused, [], 'no request was sent on a connection used before');
  const read = await forward(`${host.origin}/api/authoring-catalog`);
  assert.equal(read.status, 200);
});

test('a host that is not there fails the request once, with its cause', async () => {
  const closed = createServer(); await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const { port } = closed.address(); await new Promise(resolve => closed.close(resolve));
  await assert.rejects(forward(`http://127.0.0.1:${port}/api/authoring-edit`, { method: 'POST', body: '{}' }), error => error.code === 'ECONNREFUSED');
});
