// Controlled stored Core results for a selected item, never observations of the machine running the demo.
import { createHash } from 'node:crypto';
const OUTCOMES = { recurring: ['changed', 'match', 'changed'], 'non-recurring': ['changed', 'changed'], recovered: ['changed', 'match'] };
export function frictionFixture({ policyBytes, selections, itemId, variant = 'recurring' }) {
  selections ??= JSON.parse(new TextDecoder().decode(policyBytes)).selections;
  const matches = selections.filter(selection => selection.managementId?.endsWith(`--${itemId}`));
  if (matches.length !== 1) throw new Error('Friction fixture needs exactly one selected item.');
  const selection = matches[0];
  // Saved Catalog recipes are references. A controlled operation suffix avoids resolving their material or reading a target.
  const operations = selection.recipe?.inline?.operations?.filter(op => op.kind.startsWith('file.')) ?? [{ id: 'fixture-file-state' }];
  if (!operations.length) throw new Error('Friction fixture needs file operations.');
  const outcomes = OUTCOMES[variant === 'duplicate' ? 'recurring' : variant];
  if (!outcomes) throw new Error('Unknown friction fixture variant.');
  // Opaque capture ids and null targets keep local paths out of the stored evidence.
  const subject = createHash('sha256').update(selection.id).digest('hex').slice(0, 16);
  const entries = outcomes.map((outcome, index) => {
    const result = { schema: 'urn:aihq:core:file-state-result:1.1.0', package: { name: '@aihq/core', version: '1.0.0-dev.54' },
      status: 'complete', fileState: outcome, authority: 'not-evaluated',
      targets: operations.map(op => ({ id: `fixture-${op.id}`, operationIds: [`${selection.id}/${op.id}`], selectionIds: [selection.id], target: null, outcome, reason: 'fixture-evidence' })),
      checks: [], notChecked: [], coverage: { comparedTargets: operations.length, unavailableTargets: 0, comparedChecks: 0, unavailableChecks: 0, notChecked: 0 },
      diagnostics: [], limits: { budgetMs: 1000, elapsedMs: 0, targetBytes: 0, materialBytes: 0 } };
    return { id: `fixture:file-state:${subject}:${variant === 'duplicate' ? 'recurring' : variant}:${index + 1}`,
      sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'), capturedAt: `2026-10-${12 + index}T09:00:00Z`, fixture: true, result };
  });
  // Re-import the same capture identity, so Core can collapse it rather than counting another event.
  if (variant === 'duplicate') entries.push(structuredClone(entries[0]));
  return entries;
}
