import { setLabeller } from '../app/installed-list.js';

/**
 * The label for a recorded set on every screen, the same as the installed list's (setLabeller): the name Catalog
 * publishes for the exact set, or that name marked "(earlier release)" when this Catalog offers the set id only at
 * another digest. A saved set request names its framework by release. Undefined when this Catalog offers no set of
 * that id; never the raw id.
 */
export function setDisplayName(frameworks = [], set = {}) {
  const framework = set.framework ?? (frameworks ?? []).find(candidate => candidate.sha256 === set.releaseSha256)?.id;
  return setLabeller(frameworks ?? [])({ ...set, framework });
}

/** Said for a recorded set this Catalog no longer names. */
export const UNNAMED_SET = 'A set this catalog no longer lists';
