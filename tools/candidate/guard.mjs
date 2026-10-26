// Proof that running the candidate left the real account's Core records alone: the process was given a disposable home,
// and this compares the real home's published Core state before the candidate starts and after it stops. It never deletes anything.
import { readFileSync, writeFileSync } from 'node:fs';
import { compareCoreHome, describeCoreHomeChange, snapshotCoreHome } from '../core-home-guard.mjs';

const refusal = (code, message) => Object.assign(new Error(message), { code });

export function recordRealHome(layout, realHome, descriptor) {
  const snapshot = snapshotCoreHome(realHome, descriptor);
  writeFileSync(layout.realHomeGuard, `${JSON.stringify({ home: realHome, descriptor, recordedAt: new Date().toISOString(), snapshot: { ...snapshot, entries: [...snapshot.entries] } })}\n`);
  return { entries: snapshot.entries.size, exists: snapshot.exists };
}

export function checkRealHome(layout, realHome) {
  let record;
  try { record = JSON.parse(readFileSync(layout.realHomeGuard, 'utf8')); }
  catch { return { checked: false, unchanged: null, counts: null, message: 'No real-home snapshot was recorded, so the real account home was not checked.' }; }
  if (!Array.isArray(record?.snapshot?.entries)) throw refusal('CANDIDATE_GUARD_INVALID', `${layout.realHomeGuard} is not a real-home snapshot.`);
  const before = { ...record.snapshot, entries: new Map(record.snapshot.entries) };
  const counts = compareCoreHome(before, snapshotCoreHome(realHome ?? record.home, record.descriptor));
  return { checked: true, unchanged: counts.unchanged, counts, message: counts.unchanged ? 'unchanged' : describeCoreHomeChange(counts) };
}
