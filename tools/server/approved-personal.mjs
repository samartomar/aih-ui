import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { checkProjectFolder } from '../consumer/project-folder.mjs';
import { catalogInstallReason, verifiedCatalogFiles } from '../workbench/catalog-install.mjs';
import { selectedClientTarget } from '../workbench/client-target.mjs';
import { loadPublic } from '../workbench/local-packages.mjs';

const unavailable = reason => ({ status: 'unavailable', reason });
const safePath = path => typeof path === 'string' && isAbsolute(path) &&
  (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(path));

export function createApprovedPersonal({ consumer, catalog, sourceConsumer, project }) {
  let modules, review, processing = false;
  const load = () => modules ??= Promise.all([
    loadPublic(consumer, '@aihq/core', '.'),
    loadPublic(consumer, '@aihq/core', './contracts'),
    loadPublic(consumer, '@aihq/core', './harness'),
    loadPublic(consumer, '@aihq/catalog', './reader'),
  ]);
  const check = (core, contracts) => checkProjectFolder(project, {
    coreState: { resolveStateLocation: core.resolveStateLocation, stateLocation: contracts.stateLocation },
  });

  function status() {
    return safePath(project) ? { status: 'configured', project } : unavailable('Start the host with an approved local project folder.');
  }

  async function prepare({ items, client, binding, session }) {
    if (!safePath(project) || binding !== project) return unavailable('Confirm the project folder configured on the host.');
    if (processing) return unavailable('A different project operation is in progress.');
    processing = true;
    review = undefined;
    let staging;
    try {
      const [{ api: core }, { api: contracts }, { api: harness }, { api: reader, version }] = await load();
      if (['prepare', 'apply', 'checkFiles'].some(operation => typeof core[operation] !== 'function')) {
        return unavailable('The installed Core must publish preparation, application, and file verification.');
      }
      const target = selectedClientTarget(harness, client);
      if (target?.surface !== 'cli') return unavailable('Choose a published Core CLI target.');
      const bound = await check(core, contracts);
      if (bound.status !== 'ok' || !safePath(bound.project)) return unavailable(bound.reason ?? 'The project folder is unavailable.');
      const source = await catalog();
      if (!source) return unavailable('Start the host with prepared Catalog inputs.');
      const { response, requestParts } = source.prepareSelection(items, client);
      const refusal = catalogInstallReason(requestParts);
      if (refusal) return { ...unavailable(refusal), diagnostics: response.plan.problems ?? [] };
      let sourceCache;
      if (requestParts.plan.plan.some(step => step.from)) {
        try {
          const cached = JSON.parse(await readFile(join(sourceConsumer, 'source-cache.json'), 'utf8'));
          sourceCache = { ...cached, files: cached.files.map(file => ({ ...file,
            bytes: typeof file.bytes?.data === 'string' ? Buffer.from(file.bytes.data, 'base64') : undefined })) };
        } catch { return unavailable('The prepared Catalog source cache is unavailable.'); }
      }
      staging = await mkdtemp(join(tmpdir(), 'aih-workbench-personal-'));
      const files = await verifiedCatalogFiles(requestParts, { root: staging, sourceCache, allowNetwork: false });
      const request = { ...requestParts, schema: 'urn:aihq:core:plan-request:0.1.0', mode: 'vibe', scope: 'project',
        target: { project: bound.project, client: target }, files };
      const controls = { logging: 'off', catalog: { version, readRecipe: reader.readRecipe,
        renderStep: reader.renderStep, planRecipe: reader.planRecipe } };
      const result = await core.prepare(request, controls);
      if (result.status !== 'ready' || !result.handle || typeof result.review?.reviewDigest !== 'string') {
        return { status: result.status ?? 'unavailable', reason: 'Core did not prepare an applicable change.', diagnostics: result.diagnostics ?? [] };
      }
      review = { session, id: randomUUID(), project: bound.project, handle: result.handle,
        digest: result.review.reviewDigest, request, controls };
      return { status: 'ready', id: review.id, project: bound.project, review: result.review };
    } catch (error) {
      return unavailable(error.message);
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
      processing = false;
    }
  }

  async function apply({ id, reviewDigest, session, confirmed }) {
    if (processing) return unavailable('A different project operation is in progress.');
    if (confirmed !== true || !review || review.id !== id || review.session !== session || review.digest !== reviewDigest) {
      return unavailable('A current Core review and explicit confirmation are required.');
    }
    const selected = review;
    review = undefined;
    processing = true;
    try {
      const [{ api: core }, { api: contracts }] = await load();
      const bound = await check(core, contracts);
      if (bound.status !== 'ok' || bound.project !== selected.project) return unavailable('The reviewed project folder changed. Prepare again.');
      const result = await core.apply(selected.handle, { approved: true, origin: 'interactive', reviewDigest }, selected.controls);
      if (result.completion !== 'complete') return {
        status: 'incomplete', reason: 'Core did not report a complete application.', diagnostics: result.diagnostics ?? [],
      };
      let verification;
      try { verification = await core.checkFiles(selected.request, { catalog: selected.controls.catalog }); }
      catch { return { status: 'applied', reason: 'Core completed application. Project file verification could not run.' }; }
      return { status: 'applied', fileState: verification.fileState, diagnostics: verification.diagnostics ?? [] };
    } catch {
      return unavailable('Core could not complete this project change. Check project files before preparing again.');
    } finally { processing = false; }
  }

  return { status, prepare, apply };
}
