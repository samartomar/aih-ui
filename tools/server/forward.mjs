// One request from the Workbench to its in-process authoring host, on a connection of its own. The host shares its
// event loop with Core's work, so it can close a kept-alive connection while busy; a request sent on that connection
// fails with a reset. With no pooled connection there is none to reuse, and a request is sent once, never retried.
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';

/**
 * Sends one request and reads the whole answer. `body` is a string, bytes, a readable stream (an incoming request
 * being passed on) or absent. Resolves { status, text }; rejects with the connection's own error (its code kept).
 */
export function forward(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(url, { method, headers: { ...headers, connection: 'close' }, agent: false }, answer => {
      const chunks = [];
      answer.on('data', chunk => chunks.push(chunk));
      answer.on('end', () => resolve({ status: answer.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      answer.on('error', reject);
    });
    outgoing.on('error', reject);
    if (body instanceof Readable) { body.on('error', error => outgoing.destroy(error)); body.pipe(outgoing); }
    else outgoing.end(body);
  });
}
