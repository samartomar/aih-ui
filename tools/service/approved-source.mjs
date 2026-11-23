import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import * as catalog from '@aihq/catalog/reader';
import * as scan from '@aihq/scan/read';
import { assessmentRows } from './assessment-rows.mjs';

async function readBounded(path, limit) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size > limit) throw new Error('Source exceeds its size limit.');
    const bytes = Buffer.alloc(size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== size) throw new Error('Source changed while being read.');
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export async function approvedCatalog() {
  if (typeof catalog.readContent !== 'function' || !catalog.aihContent?.content) return { state: 'legacy' };
  const paths = process.env.AIH_APPROVED_CATALOG_CONTENT?.split(delimiter) ?? [];
  if (paths.length > 16 || paths.some(path => !isAbsolute(path))) throw new Error('Configure up to 16 absolute Catalog content paths.');
  const documents = [];
  const problems = [];
  for (const [index, path] of paths.entries()) {
    try { documents.push(await readBounded(path, 8 * 1024 * 1024)); }
    catch { problems.push(`Configured Catalog source ${index + 1} could not be read.`); }
  }
  const frameworks = new Map();
  const items = [];
  const bundled = Buffer.from(JSON.stringify(catalog.aihContent.content));
  for (const bytes of [...documents, bundled]) {
    const checked = catalog.readContent(bytes);
    if (checked.status !== 'ok') {
      problems.push(`Catalog refused a content document (${checked.status}).`);
      continue;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (frameworks.has(sha256)) continue;
    const framework = checked.content.framework;
    if (bytes === bundled && [...frameworks.values()].some(value => value.frameworkId === framework.id)) continue;
    frameworks.set(sha256, { id: sha256, frameworkId: framework.id, sha256, name: framework.name, state: 'ready' });
    for (const item of catalog.listItems(checked.content)) {
      items.push({ id: `${sha256}/${item.id}`, itemId: item.id, title: item.name ?? item.id, kind: item.kind,
        description: item.description, framework: sha256, frameworkName: framework.name, scanKey: item.scanKey,
        contentSha256: item.contentSha256 });
    }
  }
  return { state: 'read-only', frameworks: [...frameworks.values()], items, problems };
}

async function readSavedSummary(scanKey) {
  const directory = process.env.AIH_APPROVED_SCAN_SUMMARIES;
  if (!directory || !isAbsolute(directory)) return { status: 'unavailable', reason: 'No Scan summary source is configured.' };
  if (typeof scan.readSummary !== 'function') return { status: 'unavailable', reason: 'This Scan package does not publish a summary reader.' };
  if (typeof scanKey !== 'string' || !/^git-sha1:[a-f0-9]{40}$/.test(scanKey)) {
    return { status: 'no-key', reason: 'Catalog supplies no supported Scan key for this item.' };
  }
  const artifact = join(directory, scanKey.replace(':', '-'));
  let bytes;
  try { bytes = await readBounded(join(artifact, 'summary.json'), 2 * 1024 * 1024); }
  catch (error) {
    return error.code === 'ENOENT' ? { status: 'missing', reason: 'No saved Scan summary for this Catalog key.' }
      : { status: 'failed', reason: 'The saved Scan summary could not be read.' };
  }
  const checked = scan.readSummary(bytes);
  if (checked.status !== 'ok') return { status: 'invalid', reason: `Scan refused the saved summary (${checked.status}).` };
  if (checked.summary.scanKey !== scanKey) return { status: 'invalid', reason: 'The saved Scan summary has a different key.' };
  return { status: 'read', summary: checked.summary, artifact, bytes };
}

export async function approvedAssessments({ items }) {
  const directory = process.env.AIH_APPROVED_SCAN_SUMMARIES;
  if (!directory || !isAbsolute(directory)) return { status: 'unavailable', reason: 'No Scan summary source is configured.' };
  if (typeof scan.readSummary !== 'function') return { status: 'unavailable', reason: 'This Scan package does not publish a summary reader.' };
  const assessments = await assessmentRows(items, readSavedSummary);
  return { status: 'read', checkedAt: new Date().toISOString(), assessments };
}

export async function approvedEvidence({ scanKey }) {
  const selected = await readSavedSummary(scanKey);
  if (selected.status !== 'read') return ['missing', 'no-key'].includes(selected.status)
    ? { ...selected, status: 'unavailable' } : selected;
  const { artifact, bytes, summary } = selected;
  const [verification, findings] = await Promise.all([
    verifySummary(artifact, bytes), readFindings(artifact, summary),
  ]);
  return {
    status: 'read', authentication: verification.signer?.trusted === true ? 'verified' : 'not-verified', verification,
    assessment: { summary, findings: findings.rows, findingsStatus: findings.status },
  };
}

async function verifySummary(artifact, bytes) {
  if (typeof scan.verifySummary !== 'function') return { status: 'unavailable', reason: 'Scan signature verification is unavailable.' };
  try {
    const signature = await readBounded(join(artifact, 'summary.sigstore'), 2 * 1024 * 1024);
    const result = await scan.verifySummary(bytes, signature);
    return result.status === 'ok' ? { status: 'ok', signer: result.signer } : { status: result.status, reason: result.reason };
  } catch (error) {
    return error.code === 'ENOENT' ? { status: 'unavailable', reason: 'The Scan signature is missing.' }
      : { status: 'failed', reason: 'The Scan signature could not be checked.' };
  }
}

async function readFindings(artifact, summary) {
  if (typeof scan.readFindings !== 'function' || !summary.sarif?.length) return { status: 'unavailable', rows: [] };
  const rows = [];
  let status = 'read';
  for (const { path } of summary.sarif) {
    if (!/^sarif\/[a-f0-9]{64}\.sarif$/.test(path)) { status = 'partial'; continue; }
    try {
      const bytes = await readBounded(join(artifact, path), 8 * 1024 * 1024);
      const result = await scan.readFindings(summary, bytes, summary.scanKey);
      if (result.status !== 'ok') status = 'partial';
      else rows.push(...result.findings);
    } catch { status = 'partial'; }
  }
  return { status, rows };
}
