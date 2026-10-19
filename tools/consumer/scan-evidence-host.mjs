// Explicit local-file acquisition. Paths and trust come only from host configuration.
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { authenticateEvidence } from '@aihq/core';
import { acquireBaselineArtifact } from '@aihq/catalog/node';
import { readSummary, maxAssessmentBytes, maxAssessments } from '@aihq/scan/read';
import { selectContentEvidence } from './scan-evidence.mjs';

async function boundedFile(path) {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > maxAssessmentBytes) throw new Error('Evidence exceeds aggregate byte bound.');
    const bytes = await file.readFile();
    if (bytes.length > maxAssessmentBytes) throw new Error('Evidence exceeds aggregate byte bound.');
    return new Uint8Array(bytes);
  } finally { await file.close(); }
}
export function createScanEvidenceHost({ sources = [], packageRoot, trust, detectorIds } = {}) {
  if (!Array.isArray(sources) || sources.length > 16 || sources.some(source => !source || typeof source.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(source.id) || typeof source.path !== 'string' || !isAbsolute(source.path) || !['artifact', 'report'].includes(source.format)) || new Set(sources.map(source => source.id)).size !== sources.length || sources.some(source => ['release-baseline', 'supplied'].includes(source.id))) throw new Error('Configure up to 16 unique local evidence sources with absolute paths.');
  const retained = new Map(), successful = new Map();
  return {
    detail(scanId) {
      const entry = [...retained.entries()].find(([key]) => key.includes(`/${scanId}/`))?.[1];
      return entry ? { status: 'read', scanId, format: entry.format, bytes: [...entry.bytes] } : { status: 'unavailable', scanId };
    },
    async check({ inventory, itemId, supplied = [], evaluationTime, selection }) {
      if (typeof evaluationTime !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(evaluationTime) || !Number.isFinite(Date.parse(evaluationTime)) || new Date(evaluationTime).toISOString() !== evaluationTime) return { status: 'invalid', diagnostics: [{ code: 'invalid-time', detail: 'Supply an explicit valid UTC evaluation time with milliseconds.' }] };
      const assessments = [], checks = [], sourceIds = [];
      const started = performance.now(); let attemptedBytes = 0;
      let retainedBytes = [...retained.values()].reduce((sum, value) => sum + value.bytes.length, 0);
      const acquire = async (id, location, format, load, expectedScanId) => {
        sourceIds.push(id);
        try {
          const bytes = await load();
          attemptedBytes += bytes.length;
          const read = await readSummary({ format, bytes });
          if (read.status !== 'read') throw new Error(`Evidence ${read.status}: ${JSON.stringify(read.diagnostics ?? [])}`);
          if (expectedScanId !== undefined && expectedScanId !== read.summary.scanId) throw new Error('Expected Scan identity mismatch.');
          const key = `${id}/${read.summary.scanId}/${createHash('sha256').update(bytes).digest('hex')}`;
          const previousBytes = retained.get(key)?.bytes.length ?? 0;
          if (retainedBytes - previousBytes + bytes.length > maxAssessmentBytes || !retained.has(key) && retained.size >= maxAssessments) throw new Error('Evidence acquisition bound exceeded; history retained.');
          const authentication = format === 'artifact' ? await authenticateEvidence({ bytes, expectedScanId: expectedScanId ?? read.summary.scanId, trust: trust ?? { keys: [], publishers: [] } }) : undefined;
          const candidate = { sourceId: id, location, format, bytes, ...(expectedScanId ? { expectedScanId } : {}), ...(authentication ? { authentication } : {}) };
          retainedBytes += bytes.length - previousBytes;
          retained.set(key, candidate); successful.set(id, evaluationTime);
          checks.push({ sourceId: id, status: 'succeeded', attemptedAt: evaluationTime, lastSuccessfulAt: evaluationTime, diagnostics: [] });
        } catch (error) {
          checks.push({ sourceId: id, status: 'failed', attemptedAt: evaluationTime, ...(successful.has(id) ? { lastSuccessfulAt: successful.get(id) } : {}), diagnostics: [{ code: 'acquisition-failed', detail: 'Configured evidence unavailable, malformed or beyond supported bounds; earlier readable evidence retained.' }] });
        }
        for (const held of retained.values()) if (held.sourceId === id) assessments.push(held);
      };
      const baseline = inventory?.release?.baseline;
      if (baseline) await acquire('release-baseline', 'Catalog pinned baseline', 'artifact', () => acquireBaselineArtifact(baseline.artifact, { packageRoot }), baseline.scanId);
      for (const source of sources) await acquire(source.id, source.label ?? source.id, source.format, () => boundedFile(source.path), source.expectedScanId);
      // Supplied bytes are a separate explicit configured acquisition, never a trust input.
      for (const [index, bytes] of supplied.entries()) {
        const format = (() => { try { return JSON.parse(new TextDecoder().decode(bytes)).schema.startsWith('urn:aihq:scan:artifact:') ? 'artifact' : 'report'; } catch { return 'report'; } })();
        await acquire(`supplied-${index + 1}`, `Supplied document ${index + 1}`, format, async () => bytes);
      }
      // A later supply with fewer documents keeps older identities available, without claiming they were rechecked.
      for (const held of retained.values()) if (held.sourceId.startsWith('supplied-') && !sourceIds.includes(held.sourceId)) {
        sourceIds.push(held.sourceId); assessments.push(...[...retained.values()].filter(value => value.sourceId === held.sourceId));
        checks.push({ sourceId: held.sourceId, status: 'offline', attemptedAt: evaluationTime, lastSuccessfulAt: successful.get(held.sourceId), diagnostics: [] });
      }
      const acquired = performance.now();
      const result = await selectContentEvidence({ inventory, itemId, assessments, sourceIds, checks, evaluationTime, selection, detectorIds });
      return { ...result, acquisitionCost: { attemptedBytes, retainedBytes, retainedAcquisitions: retained.size,
        acquisitionMs: acquired - started, selectionMs: performance.now() - acquired } };
    }
  };
}
