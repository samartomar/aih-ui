// Preload for the staged TLS-interception condition: `NODE_OPTIONS=--import=<this file>`. Core's Node-side certificate probe is a
// raw tls.connect that ignores proxy variables, so the only way to put an inspecting proxy in its path without touching the
// machine is to reroute that one connection. AIH_CANDIDATE_TLS_ROUTE is `host=127.0.0.1:port[,host=...]`; a listed host on port 443
// (with no socket of the caller's own) is connected to the local address instead, keeping its server name. Absent variable, no
// effect. It never writes to stdout or stderr: the processes it loads into may speak IPC or JSON on them.
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

// Literal loopback addresses only: a name such as localhost goes through the hosts file.
const LOOPBACK = new Set(['127.0.0.1', '::1']);

export function parseRoutes(text) {
  const routes = new Map();
  for (const entry of String(text ?? '').split(',')) {
    const [host, target] = entry.trim().split('='), at = target?.lastIndexOf(':') ?? -1;
    if (!host || at < 1) continue;
    const address = target.slice(0, at), port = Number(target.slice(at + 1));
    // Only ever a local listener: this hook must not be able to send a connection anywhere else.
    if (LOOPBACK.has(address) && Number.isInteger(port) && port > 0 && port < 65536) routes.set(host.toLowerCase(), { host: address, port });
  }
  return routes;
}

// Both call shapes: (options[, callback]) and (port[, host][, options][, callback]).
function rewrite(args, routes) {
  const rest = [...args];
  let options, shape;
  if (rest[0] !== null && typeof rest[0] === 'object') { options = rest.shift(); shape = 'options'; }
  else {
    shape = 'port';
    const port = rest.shift(), host = typeof rest[0] === 'string' ? rest.shift() : undefined;
    options = { ...(rest[0] !== null && typeof rest[0] === 'object' ? rest.shift() : {}), port, host };
  }
  const original = options.host ?? options.hostname;
  if (typeof original !== 'string' || Number(options.port) !== 443 || options.socket || options.path) return args;
  const route = routes.get(original.toLowerCase());
  if (!route) return args;
  // `hostname` is dropped so the rewritten host is the one used.
  const { hostname: _unused, ...kept } = options;
  return [{ ...kept, host: route.host, port: route.port, servername: options.servername ?? original }, ...rest];
}

export function installRoute(routes, target = tls) {
  if (!routes.size) return target.connect;
  const connect = target.connect;
  target.connect = function aihCandidateTlsConnect(...args) { return connect.apply(this, rewrite(args, routes)); };
  return connect;
}

if (process.env.AIH_CANDIDATE_TLS_ROUTE) {
  installRoute(parseRoutes(process.env.AIH_CANDIDATE_TLS_ROUTE));
  syncBuiltinESMExports();
}
