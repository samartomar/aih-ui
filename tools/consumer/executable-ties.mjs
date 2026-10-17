// Which Core targets a Catalog item's declared executables run on, so a stored result about a target can be tied to the item that needs it. Pure: it reads
// the item and Core's published target ids, nothing else.
import { targets } from '@aihq/core/harness';

const CORE_TARGETS = new Set(targets.map(target => target.id));
// An executable that is a Core target id ties that target. The one alias: npx is installed with npm and runs on npm's configuration and registry trust. Any other
// executable (uvx, python3, ...) names no Core target and ties nothing; no other name is guessed.
const ALIASES = Object.freeze({ npx: 'npm' });
const targetOf = name => typeof name !== 'string' ? undefined : Object.hasOwn(ALIASES, name) ? ALIASES[name] : CORE_TARGETS.has(name) ? name : undefined;

// The Core target ids the item's executables run on, sorted and once each.
export function coreTargetsOf(item) {
  const declared = Array.isArray(item?.targets) ? item.targets : [];
  const found = declared.flatMap(entry => entry !== null && typeof entry === 'object' && entry.kind === 'executable' ? [targetOf(entry.name)] : []).filter(Boolean);
  return [...new Set(found)].sort();
}
