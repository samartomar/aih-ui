// Pure, DOM-free presentation of the host-configured organization authority source.
// The source is host configuration; nothing here can set or change it.
const REVISION_KEYS = ['resolvedCommit', 'blobId', 'contentDigest'];

export function sourceRows(source) {
  if (!source) return {};
  return { provider: source.provider, repository: `${source.repository?.owner}/${source.repository?.name}`,
    path: source.path, ref: `${source.revision?.kind} ${source.revision?.value}` };
}
export function revisionOf(value) {
  if (!value || REVISION_KEYS.some(key => typeof value[key] !== 'string')) return undefined;
  return { resolvedCommit: value.resolvedCommit, blobId: value.blobId, contentDigest: value.contentDigest };
}
export function compareRevision(previous, next) {
  if (!previous) return 'first';
  return REVISION_KEYS.every(key => previous[key] === next?.[key]) ? 'unchanged' : 'changed';
}
const identity = revision => `commit ${revision.resolvedCommit}, blob ${revision.blobId}, digest ${revision.contentDigest}`;
export function changeSummary(change, previous, next) {
  if (change === 'changed') return `The organization policy revision changed. Was ${identity(previous)}. Now ${identity(next)}.`;
  if (change === 'unchanged') return `The organization policy revision is unchanged: ${identity(next)}.`;
  return `First read of the organization policy: ${identity(next)}.`;
}
// A prepared review is bound to the organization revision it was made against.
export function reviewFreshness(review, latest) {
  const held = revisionOf(review?.inputs?.organization);
  if (!held || !latest) return 'none';
  return compareRevision(held, latest) === 'unchanged' ? 'current' : 'stale';
}
export const staleReviewMessage = 'The prepared review was made against an older organization policy revision. Prepare exact effects again before applying.';
// Authority facts from a Refresh (`value.authority`) or Prepare (`authority.value.authority`) result.
export function authorityFromResult(result) {
  const authority = result?.value?.authority ?? result?.authority?.value?.authority;
  return revisionOf(authority) ? authority : undefined;
}
export function setupInstructions() {
  return [
    'Organization authority is read from a source the host configures; this page cannot set it.',
    '',
    'Set AIH_ORGANIZATION_SOURCE to the path of a host JSON file:',
    '{ "provider": "github", "repository": { "owner": "<owner>", "name": "<repository>" },',
    '  "path": "<path to the organization policy>", "revision": { "kind": "branch", "value": "<name>" } }',
    'revision.kind is branch, tag or commit.',
    '',
    'Optional credentials go only in the host controls file named by AIH_CONSUMER_CONTROLS:',
    '{ "authentication": { "kind": "bearer", "token": "<token>" } }',
    '',
    'Restart the Workbench after changing either file.',
  ].join('\n');
}
