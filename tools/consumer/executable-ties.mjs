// Which Core targets a Catalog item's declared executables run on, so a stored result about a target can be tied to the item that needs it. Pure: it reads
// the item and the target definitions Core publishes, nothing else.
import { targets } from '@aihq/core/harness';

// Each command name Core publishes for a target (`executables`: its binaries and the commands that ship with it and run under its configuration, such as
// `npx` for `npm`) ties that target. Core gives every name to one target; any other executable ties nothing, and no name is guessed.
const TARGET_OF = new Map(targets.flatMap(target => (Array.isArray(target.executables) ? target.executables : []).map(name => [name, target.id])));
const targetOf = name => typeof name === 'string' ? TARGET_OF.get(name) : undefined;

// The Core target ids the item's executables run on, sorted and once each.
export function coreTargetsOf(item) {
  const declared = Array.isArray(item?.targets) ? item.targets : [];
  const found = declared.flatMap(entry => entry !== null && typeof entry === 'object' && entry.kind === 'executable' ? [targetOf(entry.name)] : []).filter(Boolean);
  return [...new Set(found)].sort();
}
