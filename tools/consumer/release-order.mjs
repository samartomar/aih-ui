// Release order an update source declares. A host lists Catalog package roots oldest first, so a later entry is newer.
// This is the host's declaration, never a producer fact: local packs that share one package version can still be
// ordered, and nothing here reads a version. Pure: no file, network or clock.
export const RELEASE_ORDER_BASIS = 'host-declared';
export const RELEASE_ORDER_TEXT = "order declared by this host's update source";
export const MAX_ORDERED_SOURCES = 8;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const position = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_ORDERED_SOURCES;
// `positions[i]` lists the release digests the source at position i + 1 offers. A release offered at several positions
// keeps its first and last, so a release listed on both sides of another is never called older or newer than it.
export function declareReleaseOrder(positions) {
  if (!Array.isArray(positions) || positions.length > MAX_ORDERED_SOURCES) throw new Error(`Declare at most ${MAX_ORDERED_SOURCES} ordered sources.`);
  const ranks = {};
  positions.forEach((releases, index) => {
    for (const sha of releases) {
      if (!hash(sha)) throw new Error('Each ordered release is a SHA-256 digest.');
      ranks[sha] = [ranks[sha]?.[0] ?? index + 1, index + 1];
    }
  });
  return { basis: RELEASE_ORDER_BASIS, ranks };
}
// JSON pointer of the first violation of the closed order shape, else null.
export function releaseOrderProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['basis', 'ranks'].includes(key))) return '';
  if (value.basis !== RELEASE_ORDER_BASIS) return '/basis';
  const { ranks } = value;
  if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks) || Object.entries(ranks).some(([sha, range]) => !hash(sha) || !Array.isArray(range)
    || range.length !== 2 || !position(range[0]) || !position(range[1]) || range[0] > range[1])) return '/ranks';
  return null;
}
// How a candidate release stands against a selected one under the declared order; undefined when no order is declared.
export function orderRelation(order, candidateSha, selectedSha) {
  if (!order) return undefined;
  const basis = order.basis, [candidate, selected] = [order.ranks[candidateSha], order.ranks[selectedSha]];
  if (candidateSha === selectedSha) return { relation: 'unknown', basis, reason: 'same-release' };
  if (!candidate || !selected) return { relation: 'unknown', basis, reason: 'not-in-source' };
  if (candidate[0] > selected[1]) return { relation: 'newer', basis };
  if (candidate[1] < selected[0]) return { relation: 'older', basis };
  return { relation: 'unknown', basis, reason: 'ambiguous' };
}
