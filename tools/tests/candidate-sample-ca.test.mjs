// The sample CA: a throwaway authority and a leaf made with Node's crypto alone, checked with Node's own X.509 reader and a real TLS handshake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import tls from 'node:tls';
import { createSampleCa } from '../candidate/sample-ca.mjs';

const now = new Date('2026-10-16T12:00:00Z');

test('the CA is a critical sample CA and the leaf is issued by it for the named hosts', () => {
  const { caPem, leafPem, leafKeyPem } = createSampleCa({ hosts: ['registry.npmjs.org', 'other.example'], now });
  const ca = new X509Certificate(caPem), leaf = new X509Certificate(leafPem);
  assert.equal(ca.ca, true);
  assert.equal(leaf.ca, false);
  assert.match(ca.subject, /sample/i);
  assert.match(ca.subject, /aih-ui owner-testing candidate/);
  assert.equal(ca.subject, ca.issuer, 'self-signed');
  assert.ok(ca.verify(ca.publicKey));
  assert.ok(leaf.checkIssued(ca));
  assert.ok(leaf.verify(ca.publicKey));
  assert.notEqual(leaf.subject, leaf.issuer);
  assert.equal(leaf.checkHost('registry.npmjs.org'), 'registry.npmjs.org');
  assert.equal(leaf.checkHost('other.example'), 'other.example');
  assert.equal(leaf.checkHost('elsewhere.example'), undefined);
  assert.match(leaf.keyUsage?.join(',') ?? '', /1\.3\.6\.1\.5\.5\.7\.3\.1/);
  assert.equal(leaf.subjectAltName, 'DNS:registry.npmjs.org, DNS:other.example');
  // The extensions, as DER: basicConstraints and keyUsage are critical, and both certificates carry key identifiers.
  const der = cert => cert.raw.toString('hex');
  assert.ok(der(ca).includes('0603551d130101ff040530030101ff'), 'CA basicConstraints CA:TRUE critical');
  assert.ok(der(ca).includes('0603551d0f0101ff04040302' + '0106'), 'CA keyUsage keyCertSign|cRLSign critical');
  assert.ok(der(ca).includes('0603551d0e'), 'CA subject key identifier');
  assert.ok(der(leaf).includes('0603551d130101ff04023000'), 'leaf basicConstraints CA:FALSE critical');
  assert.ok(der(leaf).includes('0603551d0f0101ff040403020780'), 'leaf keyUsage digitalSignature critical');
  assert.ok(der(leaf).includes('0603551d23') && der(leaf).includes('0603551d0e'), 'leaf authority and subject key identifiers');
  assert.ok(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'), 'leaf extendedKeyUsage serverAuth');
  assert.ok(new Date(leaf.validFrom) <= now && now <= new Date(leaf.validTo));
  assert.ok(new Date(ca.validFrom) <= now && now <= new Date(ca.validTo));
  assert.match(leafKeyPem, /^-----BEGIN PRIVATE KEY-----/);
  assert.ok(leaf.checkPrivateKey(createPrivateKey(leafKeyPem)));
  assert.match(caPem, /^-----BEGIN CERTIFICATE-----/);
});
test('the CA private key is never returned', () => {
  const result = createSampleCa({ hosts: ['registry.npmjs.org'], now });
  assert.deepEqual(Object.keys(result).sort(), ['caPem', 'leafKeyPem', 'leafPem']);
  assert.ok(!JSON.stringify(result).includes('EC PRIVATE KEY'));
  assert.equal((result.leafKeyPem.match(/BEGIN/g) ?? []).length, 1);
});

test('two calls make different authorities', () => {
  const a = createSampleCa({ hosts: ['registry.npmjs.org'], now }), b = createSampleCa({ hosts: ['registry.npmjs.org'], now });
  assert.notEqual(a.caPem, b.caPem);
});

test('a real TLS handshake is accepted with the sample CA and refused without it', async t => {
  const { caPem, leafPem, leafKeyPem } = createSampleCa({ hosts: ['registry.npmjs.org'], now: new Date() });
  const server = tls.createServer({ key: leafKeyPem, cert: leafPem }, socket => socket.end('hello'));
  server.on('tlsClientError', () => {});
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const connect = ca => new Promise(resolve => {
    const socket = tls.connect({ host: '127.0.0.1', port: server.address().port, servername: 'registry.npmjs.org', ...(ca ? { ca } : {}) });
    let body = '';
    socket.on('data', chunk => { body += chunk; });
    socket.on('end', () => resolve({ body }));
    socket.on('error', error => resolve({ error: error.code }));
  });
  assert.deepEqual(await connect(caPem), { body: 'hello' });
  const refused = await connect();
  assert.match(refused.error, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_GET_ISSUER/);
});
