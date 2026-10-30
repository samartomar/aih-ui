// Explicit local-file acquisition. Paths and trust come only from host configuration.
import { createHash } from 'node:crypto';
import { stable } from './primitives.mjs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { authenticateEvidence } from '@aihq/core';
import { acquireBaselineArtifact } from '@aihq/catalog/node';
import { isCheckedRelease, itemEvidenceDescriptor } from '@aihq/catalog/reader';
import { readSummary, maxAssessmentBytes, maxAssessments, summariseItem } from '@aihq/scan/read';
import { createEvidenceCache, evidenceDigest, evidenceKey } from './evidence-cache.mjs';
import { selectContentEvidence } from './scan-evidence.mjs';

class AcquisitionError extends Error {
  constructor(diagnostics) { super('Evidence acquisition refused.'); this.diagnostics = diagnostics; }
}
const acquisitionFailure = diagnostics => new AcquisitionError(diagnostics);
// Scan's readers refuse a schema as `SCHEMA_UNSUPPORTED`, but its source checks accept only lower-case codes, so the
// refusal is carried as this source's `unsupported-format` failure, its path and versions kept; any other code a check
// cannot carry fails the same one source as unreadable. Other sources are unaffected.
const checkCode = /^[a-z][a-z0-9-]{0,63}$/;
const unreadableDiagnostics = diagnostics => diagnostics.map(diagnostic => diagnostic.code === 'SCHEMA_UNSUPPORTED'
  ? { ...diagnostic, code: 'unsupported-format', detail: `${diagnostic.detail ?? `Unsupported format at ${diagnostic.path}`}; Scan record can't be read.` }
  : checkCode.test(diagnostic.code) ? diagnostic : { code: 'unreadable-report', detail: `Scan record can't be read (${String(diagnostic.code).slice(0, 64)}).` });
const boundFailure = () => acquisitionFailure([{ code: 'acquisition-limit', detail: 'Acquisition exceeds 32 retained documents or 128 MiB aggregate bytes; earlier readable evidence retained.' }]);

async function boundedFile(path) {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > maxAssessmentBytes) throw boundFailure();
    const bytes = await file.readFile();
    if (bytes.length > maxAssessmentBytes) throw boundFailure();
    return new Uint8Array(bytes);
  } finally { await file.close(); }
}
export function createScanEvidenceHost({ sources = [], packageRoot, trust, detectorIds } = {}) {
  if (!Array.isArray(sources) || sources.length > 16 || sources.some(source => !source || typeof source.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(source.id) || typeof source.path !== 'string' || !isAbsolute(source.path) || !['artifact', 'report'].includes(source.format)) || new Set(sources.map(source => source.id)).size !== sources.length || sources.some(source => source.id === 'release-baseline' || /^supplied(?:-|$)/.test(source.id))) throw new Error('Configure up to 16 unique local evidence sources with absolute paths.');
  const retained = new Map(), successful = new Map();
  const cache = createEvidenceCache();
  // Snapshot host inputs so later caller mutation cannot invalidate cached authority.
  trust = structuredClone(trust ?? { keys: [], publishers: [] });
  sources = structuredClone(sources);
  detectorIds = detectorIds?.slice();
  return {
    detail(scanId) {
      const entry = [...retained.entries()].find(([key]) => key.includes(`/${scanId}/`))?.[1];
      return entry ? { status: 'read', scanId, format: entry.format, bytes: [...entry.bytes] } : { status: 'unavailable', scanId };
    },
    async check({ inventory, itemId, supplied = [], evaluationTime, selection, withSummary = false }) {
      if (!isCheckedRelease(inventory?.release)) return { status: 'invalid', diagnostics: [{ code: 'CHECKED_RELEASE_REQUIRED', detail: 'Supply a checked Catalog release.' }] };
      if (typeof evaluationTime !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(evaluationTime) || !Number.isFinite(Date.parse(evaluationTime)) || new Date(evaluationTime).toISOString() !== evaluationTime) return { status: 'invalid', diagnostics: [{ code: 'invalid-time', detail: 'Supply an explicit valid UTC evaluation time with milliseconds.' }] };
      const assessments = [], checks = [], sourceIds = [];
      const started = performance.now(); let attemptedBytes = 0;
      let retainedBytes = [...retained.values()].reduce((sum, value) => sum + value.bytes.length, 0);
      const acquire = async (id, location, format, load, expectedScanId) => {
        sourceIds.push(id);
        try {
          const bytes = await load();
          attemptedBytes += bytes.length;
          const digest = evidenceDigest(bytes);
          const read = await cache.read(`summary/${format}/${digest}`, () => readSummary({ format, bytes }));
          if (read.status !== 'read') throw acquisitionFailure(read.diagnostics?.length ? unreadableDiagnostics(read.diagnostics) : [{ code: 'unsupported-report', detail: `Evidence reader returned ${read.status}; report schema ${read.reportSchema ?? 'unknown'}.` }]);
          if (expectedScanId !== undefined && expectedScanId !== read.summary.scanId) throw acquisitionFailure([{ code: 'expected-scan-id-mismatch', detail: `Expected ${expectedScanId}; checked bytes identify ${read.summary.scanId}. Earlier evidence retained.` }]);
          const key = `${id}/${read.summary.scanId}/${digest}`;
          const previousBytes = retained.get(key)?.bytes.length ?? 0;
          if (retainedBytes - previousBytes + bytes.length > maxAssessmentBytes || !retained.has(key) && retained.size >= maxAssessments) throw boundFailure();
          const authentication = format === 'artifact' ? await cache.read(`auth/${evaluationTime}/${digest}/${expectedScanId ?? read.summary.scanId}`, () => authenticateEvidence({ bytes, expectedScanId: expectedScanId ?? read.summary.scanId, trust })) : undefined;
          const candidate = { sourceId: id, location, format, bytes, ...(expectedScanId ? { expectedScanId } : {}), ...(authentication ? { authentication } : {}) };
          retainedBytes += bytes.length - previousBytes;
          retained.set(key, candidate); successful.set(id, evaluationTime);
          checks.push({ sourceId: id, status: 'succeeded', attemptedAt: evaluationTime, lastSuccessfulAt: evaluationTime, diagnostics: [] });
        } catch (error) {
          checks.push({ sourceId: id, status: 'failed', attemptedAt: evaluationTime, ...(successful.has(id) ? { lastSuccessfulAt: successful.get(id) } : {}),
            diagnostics: error instanceof AcquisitionError ? error.diagnostics : [{ code: 'source-unavailable', detail: `Configured evidence could not be read${typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? ` (${error.code})` : ''}; earlier readable evidence retained.` }] });
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
      const identities = assessments.map(value => ({ sourceId: value.sourceId, location: value.location, format: value.format,
        sha256: evidenceDigest(value.bytes), expectedScanId: value.expectedScanId, authentication: value.authentication }));
      const key = 'answer/' + evidenceKey({ release: inventory?.release?.sha256, itemId, identities, sourceIds, checks, evaluationTime, selection, detectorIds });
      const reused = cache.has(key);
      const result = await cache.read(key, () => selectContentEvidence({ inventory, itemId, assessments, sourceIds, checks, evaluationTime, selection, detectorIds, cache, identities }));
      let itemSummary;
      if (withSummary) {
        const descriptor = itemEvidenceDescriptor(inventory.release, { itemId });
        if (descriptor.valid) {
          // A presentation policy checks every requested detector, permits no
          // suppression and leaves unclassified severities unavailable.
          const severityProfile = { schema: 'urn:aihq:scan:severity-profile:1.0.0', id: 'workbench-display', version: '1.0.0', rules: [] };
          const evidencePolicy = { schema: 'urn:aihq:scan:evidence-policy:1.0.0', id: 'workbench-display', version: '1.0.0', requiredDetectors: [], suppressions: [],
            severityProfile: { id: severityProfile.id, sha256: createHash('sha256').update(stable(severityProfile)).digest('hex') } };
          const authentication = assessments.find(value => value.authentication?.scanId === result.selectedScanId)?.authentication ?? { status: 'skipped' };
          itemSummary = await summariseItem({ assessmentsInput: { assessments, checks, context: { sourceIds, selection: selection ?? { paths: descriptor.descriptor.materials.map(material => material.path).sort(), excludedPaths: [] } } },
            item: descriptor.descriptor, evidencePolicy, severityProfile, authentication, trustStatus: (trust.keys?.length || trust.publishers?.length) ? 'available' : 'unavailable', evaluationTime });
        } else itemSummary = { status: 'unavailable', diagnostics: descriptor.diagnostics };
      }
      return { ...result, ...(itemSummary ? { itemSummary } : {}), acquisitionCost: { reused, attemptedBytes, retainedBytes, retainedAcquisitions: retained.size,
        acquisitionMs: acquired - started, selectionMs: performance.now() - acquired } };
    }
  };
}
