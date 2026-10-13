import { readFile } from 'node:fs/promises';
import { intakeDeclaration, digestBytes } from './intake.mjs';
import { composeAuthoring, readAuthoring, reconcileAuthoring, editAuthoring, freshAuthoring, stable, refuse } from './headless.mjs';
const encode = value => new TextEncoder().encode(value);
export async function createMixedService(maintained) {
  const declarationBytes = new Uint8Array(await readFile(new URL('./fixtures/review-note/declaration.json', import.meta.url)));
  const files = Object.fromEntries(await Promise.all(['recipe.json', 'note.md', 'LICENSE'].map(async name => [name, new Uint8Array(await readFile(new URL(`./fixtures/review-note/${name}`, import.meta.url)))])));
  async function supplied(bytes, sourceFiles, id = 'notes') {
    const input = { id, kind: 'local', locator: { input: id }, resolvedIdentity: { sha256: await digestBytes(bytes) } };
    const result = await intakeDeclaration({ input, declarationBytes: bytes, sourceFiles: [{ source: 'notes', revision: 'b'.repeat(40), files: sourceFiles }], materialSource: { kind: 'local', input: id } });
    if (result.status !== 'ok') throw new Error(JSON.stringify(result.diagnostics));
    return result.value;
  }
  const notes = await supplied(declarationBytes, files);
  // Explicit authored demonstration template, not a maintained Catalog offering.
  const root = (entry, item) => ({ releaseSha256: entry.release.sha256, itemId: item.id, itemSha256: item.itemSha256, scope: item.scopes[0], configuration: {}, originIds: ['direct'] });
  async function template(entry) {
    const value = { id: 'authored.mixed-example', roots: entry.release.items.map(item => { const value = root(entry, item); delete value.originIds; return value; }) };
    return { ...value, sha256: await digestBytes(encode(stable(value))) };
  }
  notes.templates = [await template(notes)];
  const changedDeclaration = JSON.parse(new TextDecoder().decode(declarationBytes));
  changedDeclaration.package.version = '1.0.1';
  const changed = await supplied(encode(JSON.stringify(changedDeclaration)), { ...files, 'note.md': encode(new TextDecoder().decode(files['note.md']) + '\nAn explicit updated note snapshot.\n') });
  changed.templates = [await template(changed)];
  const current = [maintained, notes], all = [maintained, notes, changed];
  const candidates = mode => mode === 'missing' ? [maintained] : mode === 'updated' ? [maintained, changed] : current;
  return {
    inventories: all,
    catalog() { return { executionAvailable: false, description: 'Real maintained Catalog content and independently authored review-note. Template is an authored demonstration.',
      items: current.flatMap(entry => entry.release.items.map(item => ({ ...item, root: root(entry, item), package: entry.release.package }))),
      templates: notes.templates.map(t => ({ ...t, releaseSha256: notes.release.sha256 })) }; },
    async run(operation, body) {
      const policyBytes = body.policyBytes ? Uint8Array.from(body.policyBytes) : undefined;
      if (operation === 'new') return composeAuthoring({ intent: freshAuthoring(), inventories: all });
      if (operation === 'read') return readAuthoring({ policyBytes, inventories: body.availability === 'missing' ? [maintained] : all });
      if (operation === 'compose') return composeAuthoring({ basePolicyBytes: policyBytes, intent: body.intent, inventories: all });
      if (operation === 'edit') return editAuthoring({ policyBytes, inventories: all, operation: body.operation });
      if (operation === 'reconcile') return reconcileAuthoring({ savedPolicyBytes: policyBytes, inventories: all, candidateInventories: candidates(body.candidateMode) });
      if (operation === 'intake') {
        const result = await intakeDeclaration({ ...body.snapshot, declarationBytes: Uint8Array.from(body.snapshot.declarationBytes),
          ...(body.snapshot.archiveBytes ? { archiveBytes: Uint8Array.from(body.snapshot.archiveBytes) } : {}),
          sourceFiles: body.snapshot.sourceFiles.map(source => ({ ...source, files: Object.fromEntries(Object.entries(source.files).map(([name, bytes]) => [name, Uint8Array.from(bytes)])) })) });
        if (result.status === 'ok') {
          if (!all.some(e => e.release.sha256 === result.value.release.sha256)) all.push(result.value);
          if (!current.some(e => e.release.sha256 === result.value.release.sha256)) current.push(result.value);
        }
        return result;
      }
      return refuse('INPUT_INVALID', '/operation', 'Unsupported authoring operation.', policyBytes);
    }
  };
}
