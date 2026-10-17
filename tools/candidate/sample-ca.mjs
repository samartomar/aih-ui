// A throwaway certificate authority and one server certificate, made with Node's crypto and a small DER writer: no openssl and
// no dependency. It exists so the staged TLS-interception condition has something real to be trusted or distrusted. The CA's
// private key signs the leaf once, in memory, and is dropped: nothing can issue another certificate from this CA afterwards.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const length = size => {
  if (size < 0x80) return Buffer.from([size]);
  const bytes = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), length(body.length), body]); };
const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const integer = bytes => { let value = Buffer.from(bytes); while (value.length > 1 && value[0] === 0 && !(value[1] & 0x80)) value = value.subarray(1); return tlv(0x02, value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value); };
const boolean = value => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const octets = bytes => tlv(0x04, bytes);
const bits = (bytes, unused = 0) => tlv(0x03, Buffer.from([unused]), bytes);
const utf8 = text => tlv(0x0c, Buffer.from(text, 'utf8'));
const oid = dotted => {
  const [first, second, ...rest] = dotted.split('.').map(Number), bytes = [40 * first + second];
  for (const part of rest) {
    const group = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) group.unshift(0x80 | (value & 0x7f));
    bytes.push(...group);
  }
  return tlv(0x06, Buffer.from(bytes));
};
// UTCTime stops at 2049; later dates must be GeneralizedTime.
const time = date => {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
};

const OID = { commonName: '2.5.4.3', ecdsaSha256: '1.2.840.10045.4.3.2', basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', subjectKeyIdentifier: '2.5.29.14',
  authorityKeyIdentifier: '2.5.29.35', extendedKeyUsage: '2.5.29.37', subjectAltName: '2.5.29.17', serverAuth: '1.3.6.1.5.5.7.3.1' };
const name = commonName => sequence(set(sequence(oid(OID.commonName), utf8(commonName))));
const extension = (id, critical, value) => sequence(oid(id), ...(critical ? [boolean(true)] : []), octets(value));
const algorithm = sequence(oid(OID.ecdsaSha256));
const newKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = key => key.export({ type: 'spki', format: 'der' });
// The key identifier is the SHA-1 of the public key bits: the uncompressed P-256 point is the last 65 bytes of its SPKI.
const keyIdentifier = key => createHash('sha1').update(spki(key).subarray(-65)).digest();
// A positive serial, 16 random bytes with the top bit cleared.
const serial = () => { const bytes = randomBytes(16); bytes[0] &= 0x7f; bytes[0] |= 0x01; return integer(bytes); };

function certificate({ subject, issuer, key, signer, notBefore, notAfter, extensions }) {
  const tbs = sequence(tlv(0xa0, integer(Buffer.from([2]))), serial(), algorithm, name(issuer), sequence(time(notBefore), time(notAfter)), name(subject), spki(key),
    tlv(0xa3, sequence(...extensions)));
  const signature = sign('sha256', tbs, { key: signer, dsaEncoding: 'der' });
  const der = sequence(tbs, algorithm, bits(signature));
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

// `hosts` become the leaf's DNS names. The CA is valid from a day before `now` (clock skew) for `days` days.
export function createSampleCa({ hosts, now = new Date(), days = 365 } = {}) {
  if (!Array.isArray(hosts) || !hosts.length) throw new TypeError('createSampleCa needs at least one host.');
  const ca = newKey(), leaf = newKey();
  const notBefore = new Date(now.getTime() - 24 * 3600_000), notAfter = new Date(now.getTime() + days * 24 * 3600_000);
  const caName = 'aih-ui owner-testing candidate sample CA (sample only)';
  const caPem = certificate({ subject: caName, issuer: caName, key: ca.publicKey, signer: ca.privateKey, notBefore, notAfter, extensions: [
    extension(OID.basicConstraints, true, sequence(boolean(true))),
    extension(OID.keyUsage, true, bits(Buffer.from([0x06]), 1)),
    extension(OID.subjectKeyIdentifier, false, octets(keyIdentifier(ca.publicKey))),
  ] });
  const leafPem = certificate({ subject: hosts[0], issuer: caName, key: leaf.publicKey, signer: ca.privateKey, notBefore, notAfter, extensions: [
    extension(OID.basicConstraints, true, sequence()),
    extension(OID.keyUsage, true, bits(Buffer.from([0x80]), 7)),
    extension(OID.extendedKeyUsage, false, sequence(oid(OID.serverAuth))),
    extension(OID.subjectAltName, false, sequence(...hosts.map(host => tlv(0x82, Buffer.from(host, 'ascii'))))),
    extension(OID.authorityKeyIdentifier, false, sequence(tlv(0x80, keyIdentifier(ca.publicKey)))),
    extension(OID.subjectKeyIdentifier, false, octets(keyIdentifier(leaf.publicKey))),
  ] });
  return { caPem, leafPem, leafKeyPem: leaf.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
