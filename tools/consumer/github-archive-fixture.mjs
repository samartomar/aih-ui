// Test fixture only: local archives shaped like GitHub's, so no test needs the network.
import { gzipSync } from 'node:zlib';
const COMMIT = 'd81f3a183412e71a5b1e84ca21bc1a35eea03a60';
// A small ustar writer for local fixture archives, shaped like the ones GitHub serves for a commit: a pax global header
// whose comment is the commit, then every entry under one "<repo>-<commit>/" folder.
export function tarHeader(name, { type = '0', size = 0, linkname = '' } = {}) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100); block.write('0000000\0', 108); block.write('0000000\0', 116);
  block.write(size.toString(8).padStart(11, '0') + '\0', 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write(type, 156);
  block.write(linkname, 157, 100, 'utf8');
  block.write('ustar\0', 257); block.write('00', 263);
  let sum = 0; for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return block;
}
const pad = bytes => Buffer.concat([bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
const paxRecord = (key, value) => {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length = String(length).length + body.length;
  return `${length}${body}`;
};
export function tarball(entries, { commit = COMMIT, root = `skills-${COMMIT}/`, gzip = true } = {}) {
  const pax = Buffer.from(paxRecord('comment', commit));
  const parts = commit === null ? [] : [tarHeader('pax_global_header', { type: 'g', size: pax.length }), pad(pax)];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.text ?? '');
    const name = entry.raw ? entry.path : root + entry.path;
    if (entry.longPath) {
      const record = Buffer.from(paxRecord('path', name));
      parts.push(tarHeader('PaxHeader', { type: 'x', size: record.length }), pad(record));
    }
    parts.push(tarHeader(entry.longPath ? 'short' : name, { type: entry.type ?? '0', size: entry.type && entry.type !== '0' ? 0 : bytes.length, linkname: entry.linkname ?? '' }));
    if (!entry.type || entry.type === '0') parts.push(pad(bytes));
  }
  parts.push(Buffer.alloc(1024));
  const tar = Buffer.concat(parts);
  return gzip ? gzipSync(tar) : tar;
}
