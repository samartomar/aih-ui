import { setLabeller } from '../app/installed-list.js';

/**
 * The label for a recorded set on every screen, the same as the installed list's (setLabeller): the name Catalog
 * publishes for the exact set, or that name marked "(earlier release)" when this Catalog offers the set id only at
 * another digest. A saved set request records only its release, which a newer Catalog no longer has; its framework is
 * then the one offering the exact set, else the only one offering a set of that id. Undefined when none does; never
 * the raw id.
 */
export function setDisplayName(frameworks = [], set = {}) {
  frameworks ??= [];
  const offering = predicate => frameworks.filter(framework => (framework.sets ?? []).some(predicate));
  const exact = offering(candidate => candidate.id === set.setId && candidate.setSha256 === set.setSha256);
  const sameId = offering(candidate => candidate.id === set.setId);
  const framework = set.framework ?? frameworks.find(candidate => candidate.sha256 === set.releaseSha256)?.id
    ?? exact[0]?.id ?? (sameId.length === 1 ? sameId[0].id : undefined);
  return framework === undefined ? undefined : setLabeller(frameworks)({ ...set, framework });
}

/** Said for a recorded set this Catalog no longer names, in row 33's words. */
export const UNNAMED_SET = 'a set this catalog no longer offers';
