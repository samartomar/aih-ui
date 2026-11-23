import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { checkProjectFolder } from '../consumer/project-folder.mjs';
import { catalogInstallReason, verifiedCatalogFiles } from '../workbench/catalog-install.mjs';
import { selectedClientTarget } from '../workbench/client-target.mjs';
import { loadPublic } from '../workbench/local-packages.mjs';
import { organizationFileChange, personalFileChange, validPersonalFile } from './enterprise-core-policy.mjs';

const unavailable = reason => ({status:'unavailable',reason});
const safePath = path => typeof path === 'string' && isAbsolute(path) &&
  (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(path));
const sourceIdentity = source => JSON.stringify([source.repository, source.baseBranch, source.path, source.commitSha, source.blobSha]);
const stale = reason => ({status:'rejected', reason, diagnostics:[{code:'REVIEW_STALE', changed:'policy'}]});

export function createEnterpriseExecution({ consumer, catalog, sourceConsumer, project, readPolicy }) {
  let modules, review, processing = false;
  const load = () => modules ??= Promise.all([
    loadPublic(consumer, '@aihq/core', '.'),
    loadPublic(consumer, '@aihq/core', './contracts'),
    loadPublic(consumer, '@aihq/core', './harness'),
    loadPublic(consumer, '@aihq/catalog', './reader'),
  ]);
  const check = (core, contracts) => checkProjectFolder(project, {
    coreState: {resolveStateLocation:core.resolveStateLocation, stateLocation:contracts.stateLocation},
  });
  const cleanup = directory => directory && rm(directory, {recursive:true,force:true}).catch(() => {});

  function status() {
    return safePath(project) && readPolicy ? {status:'configured',project} :
      unavailable('Start the host with a managed GitHub policy source and an approved local project folder.');
  }

  async function close() {
    const active = review;
    review = undefined;
    await cleanup(active?.staging);
  }

  async function prepare({ items, files, organizationFiles, client, binding, source, session }) {
    if (status().status !== 'configured' || binding !== project) return unavailable('Confirm the project folder configured on this Enterprise host.');
    if (processing) return unavailable('A different Enterprise project operation is in progress.');
    processing = true;
    let staging;
    try {
      await close();
      const [{api:core}, {api:contracts}, {api:harness}, {api:reader,version}] = await load();
      if (typeof core.prepare !== 'function' || typeof core.apply !== 'function') {
        return unavailable('The installed Core does not provide native preparation and application.');
      }
      const target = selectedClientTarget(harness, client);
      if (target?.surface !== 'cli') return unavailable('Choose a published Core CLI target.');
      const bound = await check(core, contracts);
      if (bound.status !== 'ok' || !safePath(bound.project)) return unavailable(bound.reason ?? 'The project folder is unavailable.');
      const directory = await stat(bound.project, {bigint:true});
      const managed = await readPolicy();
      if (managed.status !== 'ready' || typeof managed.text !== 'string') return unavailable('Read the managed organization policy before preparing changes.');
      if (!source || !managed.source || sourceIdentity(source) !== sourceIdentity(managed.source)) {
        return stale('The managed organization revision changed. Refresh it before preparing changes.');
      }

      staging = await mkdtemp(join(tmpdir(), 'aih-workbench-enterprise-'));
      const policyPath = join(staging, 'organization.json');
      await writeFile(policyPath, managed.text, {flag:'wx',mode:0o600});
      const controls = {
        logging:'off', organization:{provider:'local',path:policyPath},
      };
      const common = { mode:'enterprise', scope:'project', target:{project:bound.project, client:target} };
      let request;
      if (organizationFiles) {
        if (items.length || files.length) return unavailable('Review the organization files on their own.');
        files = managed.selection?.files?.filter(file => file.clients?.includes(target.id)) ?? [];
        if (!files.length) return unavailable('This revision has no organization files to prepare.');
      }
      if (files.length) {
        if (items.length || files.length > (organizationFiles ? 16 : 8) || files.some(file => !validPersonalFile(file)) ||
          new Set(files.map(file => file.name.toLowerCase())).size !== files.length) {
          return unavailable('Use uniquely named supporting text files and review them separately from Catalog content.');
        }
        request = { ...common, schema:'urn:aihq:core:change-request:0.1.0', changes:files.map(({name,text}) => ({
          managementId:(organizationFiles ? 'organization-file-' : 'personal-file-') + createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0,24),
          change:organizationFiles ? organizationFileChange(name) : personalFileChange, inputs:{name,text}, requires:[],
        })) };
      } else {
        controls.catalog = {version, readRecipe:reader.readRecipe, renderStep:reader.renderStep, planRecipe:reader.planRecipe};
        const catalogSource = await catalog();
        if (!catalogSource) return unavailable('Start the host with prepared Catalog inputs.');
        const { response, requestParts } = catalogSource.prepareSelection(items, client);
        const refusal = catalogInstallReason(requestParts);
        if (refusal) return {...unavailable(refusal), diagnostics:response.plan.problems ?? []};
        let sourceCache;
        if (requestParts.plan.plan.some(step => step.from)) {
          try {
            const cached = JSON.parse(await readFile(join(sourceConsumer,'source-cache.json'),'utf8'));
            sourceCache = {...cached, files:cached.files.map(file => ({...file,
              bytes:typeof file.bytes?.data === 'string' ? Buffer.from(file.bytes.data,'base64') : undefined }))};
          } catch { return unavailable('The prepared Catalog source cache is unavailable.'); }
        }
        const verified = await verifiedCatalogFiles(requestParts, {root:staging,sourceCache,allowNetwork:false});
        request = {...requestParts, ...common, schema:'urn:aihq:core:plan-request:0.1.0', files:verified};
      }
      const result = await core.prepare(request, controls);
      if (result.status !== 'ready' || !result.handle || typeof result.review?.reviewDigest !== 'string') {
        const denials = result.review?.organization?.denials;
        const diagnostics = result.diagnostics ?? result.problems ?? denials ?? [];
        const reason = result.code === 'AUTHORITY_DENIED'
          ? 'Core blocked this request under the current organization policy.'
          : result.reason ?? 'Core did not prepare an applicable Enterprise change.';
        return {status:result.status ?? 'unavailable', code:result.code, reason, diagnostics, review:result.review};
      }
      review = {session,id:randomUUID(),project:bound.project,directory,handle:result.handle,
        digest:result.review.reviewDigest,source:managed.source,request,controls,staging};
      staging = undefined;
      return {status:'ready',id:review.id,project:bound.project,review:result.review,source:review.source};
    } catch (error) {
      return unavailable(error.message);
    } finally {
      await cleanup(staging);
      processing = false;
    }
  }

  async function apply({id, reviewDigest, session, confirmed}) {
    if (processing) return unavailable('A different Enterprise project operation is in progress.');
    if (confirmed !== true || !review || review.id !== id || review.session !== session || review.digest !== reviewDigest) {
      return unavailable('A current Core review and explicit confirmation are required.');
    }
    const selected = review;
    review = undefined;
    processing = true;
    try {
      const [{api:core}, {api:contracts}] = await load();
      const bound = await check(core, contracts);
      if (bound.status !== 'ok' || bound.project !== selected.project) return unavailable('The reviewed project folder changed. Prepare again.');
      const directory = await stat(bound.project, {bigint:true});
      if (directory.dev !== selected.directory.dev || directory.ino !== selected.directory.ino) {
        return unavailable('The reviewed project folder was replaced. Prepare again.');
      }
      const managed = await readPolicy().catch(() => null);
      if (managed?.status !== 'ready' || !managed.source || sourceIdentity(managed.source) !== sourceIdentity(selected.source) ||
        managed.text !== await readFile(selected.controls.organization.path, 'utf8')) {
        return stale('The managed organization revision changed or could not be read. Prepare again.');
      }
      const { completion, diagnostics, members, operations } = await core.apply(
        selected.handle, {approved:true,origin:'interactive',reviewDigest}, selected.controls);
      if (completion !== 'complete') return {status:completion ?? 'incomplete',
        reason:'Core did not report a complete application.', diagnostics, members, operations};
      if (selected.request.changes) return {status:'applied', diagnostics, members, operations};
      const verification = await core.checkFiles(selected.request, {catalog:selected.controls.catalog}).catch(() => null);
      return {status:'applied', fileState:verification?.fileState, diagnostics:verification?.diagnostics ?? diagnostics, members};
    } catch {
      return unavailable('Core could not complete this Enterprise change. Check project files before preparing again.');
    } finally {
      await cleanup(selected.staging);
      processing = false;
    }
  }

  async function impact() {
    if (status().status !== 'configured') return status();
    try {
      const [{api:core}, {api:contracts}, {api:harness}] = await load();
      const bound = await check(core, contracts);
      if (bound.status !== 'ok') return unavailable(bound.reason ?? 'The project folder is unavailable.');
      const managed = await readPolicy();
      if (managed.status !== 'ready') return unavailable('The managed organization policy is unavailable.');
      const installed = await core.list({target:{project:bound.project},scope:'project'});
      if (installed.status !== 'ok') return unavailable('Core could not read the project inventory.');
      const organization = JSON.parse(managed.text);
      const source = await catalog();
      const entries = [];
      for (const record of installed.entries) {
        const itemIds = record.items?.length ? record.items : [null];
        const clients = record.clis?.length ? record.clis : [null];
        for (const itemId of itemIds) for (const client of clients) {
          const row = {itemId,client,managementId:record.managementId,status:'unknown'};
          entries.push(row);
          const matches = source?.catalog.items.filter(entry => entry.id === itemId);
          if (matches?.length !== 1) continue;
          const [item] = matches;
          const framework = source?.catalog.frameworks.find(entry => entry.id === item?.framework);
          const target = client && selectedClientTarget(harness, client);
          if (!item || !framework || target?.surface !== 'cli') continue;
          row.id = framework.sha256 + '/' + itemId;
          const { requestParts } = source.prepareSelection([{id:row.id,itemId}],client);
          if (!requestParts) continue;
          const files = [...new Map(requestParts.plan.plan.filter(step => step.from)
            .map(({from:{sourceId,sourcePath,sha256}}) => [JSON.stringify([sourceId,sourcePath]),{sourceId,sourcePath,sha256}])).values()];
          const request = {...requestParts, plan:{...requestParts.plan,data:record.data}, files,
            schema:'urn:aihq:core:plan-request:0.1.0',mode:'enterprise',scope:'project',target:{project:bound.project,client:target}};
          const result = await contracts.previewAdmission({organization,request,installed});
          if (result.status !== 'ok') { row.diagnostics = result.problems; continue; }
          row.status = result.value.admitted ? 'allowed' : 'denied';
          row.denials = result.value.denials;
        }
      }
      return {status:'ready', observation:installed.observation, project:bound.project, source:managed.source, entries};
    } catch (error) {
      return unavailable(error.message);
    }
  }

  return { status, prepare, apply, close, impact };
}
