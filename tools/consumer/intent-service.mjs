import { composeIntent, freshIntent, reopenIntent, transactIntent, reviewIntentUpdate, indexReleases } from './saved-intent.mjs';
import { journeyFixture, scaleFixture, rootFor } from './intent-fixtures.mjs';

// Synthetic data is deliberately isolated from the public execution host.
export function createIntentService() {
  const journey = journeyFixture();
  const inventories = new Map([['journey', journey]]);
  function inventory(name = 'journey') {
    if (!['journey', 'six', 'seven'].includes(name)) throw new Error('Unknown illustrative inventory.');
    if (!inventories.has(name)) {
      const entries = scaleFixture(name === 'six' ? 6 : 7);
      inventories.set(name, { entries, index: indexReleases(entries), templates: [], replacements: {} });
    }
    return inventories.get(name);
  }
  return {
    catalog(name, stage = 'current') {
      const data = inventory(name), index = stage === 'next' ? data.nextIndex : data.index;
      if (!index) throw new Error('No update configured for this inventory.');
      return { synthetic: true, executionAvailable: false, templates: data.templates,
        items: index.entries.flatMap(entry => entry.release.items.map(item => ({ ...item, releaseSha256: entry.release.sha256,
          package: entry.release.package, root: rootFor(entry, item.id) }))),
        provenance: index.entries.map(entry => ({ releaseSha256: entry.release.sha256, package: entry.release.package, sources: entry.release.sources })) };
    },
    run(operation, body) {
      const data = inventory(body.inventory), index = body.stage === 'next' ? data.nextIndex : data.index;
      if (!index) throw new Error('No update configured for this inventory.');
      const args = { index, templates: data.templates, policyText: body.policyText };
      if (operation === 'new') return composeIntent({ index, templates: data.templates, intent: freshIntent(), mode: body.mode, capture: true });
      // Saved exact identities choose snapshots; a fresh client's presentation stage does not.
      const knownIndex = data.nextIndex ? indexReleases([...new Map([...data.index.entries, ...data.nextIndex.entries]
        .map(entry => [entry.release.sha256, entry])).values()]) : data.index;
      if (operation === 'reopen') {
        const result = reopenIntent({ ...args, index: knownIndex });
        if (!result.valid || !result.editable) return result;
        const nextIds = new Set(data.nextIndex?.entries.map(entry => entry.release.sha256) ?? []);
        return { ...result, stage: result.intent.provenance.some(source => nextIds.has(source.releaseSha256)) ? 'next' : 'current' };
      }
      if (operation === 'edit') return transactIntent({ ...args, index: knownIndex, operation: body.operation });
      if (operation === 'update') {
        if (!data.nextIndex) throw new Error('No update configured for this inventory.');
        return reviewIntentUpdate({ ...args, previousIndex: data.index, index: knownIndex, replacements: data.replacements, resolutions: body.resolutions });
      }
      throw new Error('Unknown saved-intent operation.');
    }
  };
}
