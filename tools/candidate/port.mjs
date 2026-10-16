// The candidate never takes the ordinary preview's port (4173), and never starts on a port something else already holds.
import { createServer } from 'node:net';
import { RESERVED_PORTS } from './layout.mjs';

const refusal = (code, message) => Object.assign(new Error(message), { code });

export async function assertPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw refusal('CANDIDATE_PORT_INVALID', `The port must be an integer between 1 and 65535 (received ${port}).`);
  if (RESERVED_PORTS.includes(port)) throw refusal('CANDIDATE_PORT_RESERVED', `Port ${port} is reserved for the ordinary preview (tools/preview.mjs). Choose another port.`);
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(error.code === 'EADDRINUSE'
      ? refusal('CANDIDATE_PORT_IN_USE', `Port ${port} is already in use on 127.0.0.1. Choose another port.`)
      : refusal('CANDIDATE_PORT_UNAVAILABLE', `Port ${port} cannot be used on 127.0.0.1: ${error.code ?? error.message}`)));
    probe.listen(port, '127.0.0.1', () => probe.close(error => (error ? reject(error) : resolve())));
  });
}
