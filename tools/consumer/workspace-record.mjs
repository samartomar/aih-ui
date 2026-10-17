// Shapes of the optional workspace records a journey envelope carries: the portable workspace declaration and a local
// checkout binding. Internal to the journey reader and the workspace module (not a package export): both validate
// records with exactly these rules. A declaration never holds an absolute local path or a credential; a binding is
// local state and never portable execution permission.
import { digestJson as digest, hash, object, only } from './primitives.mjs';
import { isUtcTimestamp } from './maintenance-record.mjs';
export const WORKSPACE_DECLARATION_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:workspace-declaration:1.0.0';
export const LOCAL_BINDING_RECORD_SCHEMA = 'urn:aihq:workbench:journey-record:local-binding:1.0.0';
export const WORKSPACE_DECLARATION_RECORD_ID = 'workspace-declaration';
export const RELATIONSHIP_KINDS = ['depends-on', 'consumes-api', 'deploys', 'shares-contract'];
export const PROVENANCE_KINDS = ['owner', 'contract', 'instruction'];
export const BINDING_REASONS = ['additional-checkout', 'ambiguous-remote', 'fork', 'moved', 'no-remote', 'similar-name'];
export const MAX_MEMBERS = 64, MAX_RELATIONSHIPS = 256, MAX_BINDINGS = 256;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/, commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, remoteName = /^(?:[\w./-]{1,200}|\(unrecognized\))$/;
// A remote whose name this module cannot carry is recorded under this name with no identity, so it still counts as an unresolved remote.
export const UNRECOGNIZED_REMOTE = '(unrecognized)';
const list = (value, max, each, min = 0) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(each);
const sortedUnique = values => values.every((value, index) => index === 0 || values[index - 1] < value);
// A drive path, a UNC path, a file URL, a home path, an absolute POSIX path under a root a local machine uses (at any depth), a
// top-level file-like absolute path such as /private.pem, a URL with userinfo or a recognizable credential: refused wherever free
// text or a location is accepted. A path counts only where it starts (not inside a longer word, file name or scheme authority), so
// a repository path such as `src/home/index.ts`, a route such as `/v1/orders/` and text such as `serves api/root/health` stay valid.
const start = String.raw`(?:^|[\s"'(=,;])`;
const alone = String.raw`(?<![A-Za-z0-9._-])(?<!:/)`;
const LOCAL_ROOTS = 'home|Users|root|srv|opt|mnt|Volumes|var|tmp|etc|private|media|usr|run|data|proc|dev|sys|Library|Applications|System|workspace|workspaces|builds|nix|scratch';
// Container roots that are also common route prefixes (`/app/health`, `/src/list`): a path needs two segments below them.
const CONTAINER_ROOTS = 'app|code|work|src';
// File names that hold credentials, refused as an absolute path at any depth.
const SECRET_FILES = String.raw`id_rsa|id_dsa|id_ecdsa|id_ed25519|\.env(?:\.[\w-]+)*|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|\.aws/credentials|credentials\.json`;
// An assignment name: `client_secret=` counts, `max_token=` is a different name only for the eight-character rule below.
const named = String.raw`(?<![A-Za-z0-9])`;
const LOCAL_OR_SECRET = [/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/, /\\\\/, /\bfile:/i, new RegExp(String.raw`${start}~[\\/]`), new RegExp(String.raw`${alone}/(?:${LOCAL_ROOTS})/[^\s/]`, 'i'),
  new RegExp(String.raw`${alone}/(?:${CONTAINER_ROOTS})/[^\s/]+/[^\s/]`, 'i'), new RegExp(String.raw`${alone}/(?:[^\s/]+/)*(?:${SECRET_FILES})(?![\w.-])`, 'i'),
  new RegExp(String.raw`${alone}/[\w-][\w.-]*\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,8}(?![\w/-])`), /:\/\/[^\s/?#]*@/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, /\bgithub_pat_/, /\bglpat-/, /\bxox[abprs]-/, /\bsk-[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/,
  // A password or secret assignment holds a credential whatever its length; a token or key assignment once its value is eight or more characters.
  // Configuration words (`secret=true`, `password = required`) are not credentials.
  // The configuration word must be the whole value (`password=true!x` is a password).
  new RegExp(String.raw`${named}(?:secret|password|passwd|pwd)\s*=\s*(?!(?:true|false|required|none|null)(?:$|[\s&;,)]))\S`, 'i'), /\b(?:access_token|token|api[_-]?key|apikey)\s*=\s*\S{8,}/i];
// `password: value`: a value of six or more characters that holds a digit or a symbol (not a plain word such as "reset").
const labelledSecret = value => [...value.matchAll(/\b(?:password|passwd|secret|api[_-]?key)\s*:\s*(\S+)/gi)].some(([, found]) => { const token = found.replace(/[.,;)\]"']+$/, ''); return token.length >= 6 && /[^A-Za-z]/.test(token); });
export const unsafeText = value => typeof value === 'string' && (LOCAL_OR_SECRET.some(pattern => pattern.test(value)) || labelledSecret(value));
export const plain = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const text = (value, max) => plain(value, max) && !unsafeText(value);
export const isSlug = value => typeof value === 'string' && slugPattern.test(value);
// A path inside the repository: never absolute, never above or inside a special segment.
export const isRepoPath = value => plain(value, 512) && !unsafeText(value) && !/^[/\\~]/.test(value) && !/^[A-Za-z]:/.test(value) && !value.includes('\\')
  && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
const isUrn = value => plain(value, 300) && /^urn:[a-z0-9][a-z0-9-]{0,31}:[\w.:@%/+-]+$/i.test(value);
// ---- Remote identity ---------------------------------------------------------------------------------------------
const DEFAULT_PORTS = { http: '80', https: '443', ssh: '22', 'git+ssh': '22', git: '9418' }, SCHEMES = Object.keys(DEFAULT_PORTS);
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, SEGMENT = /^[\w.+~-]+$/;
// `host[:port]/owner/name` of a remote, or null for anything that is not a recognizable network repository. Userinfo
// (credentials), query and a trailing `.git` are dropped, so the result never carries a secret; a port stays unless it is the
// scheme's default, since another port is another service; local paths and file URLs are null and never echoed. Owner may hold
// subgroups; owner and name keep their case.
export function remoteIdentity(url) {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  if (value.length === 0 || value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value)) return null;
  let host, path, port = '';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
  if (scheme) {
    const kind = scheme[1].toLowerCase();
    if (!SCHEMES.includes(kind)) return null;
    const rest = value.slice(scheme[0].length), end = rest.search(/[/?#]/);
    if (end < 0) return null;
    const authority = rest.slice(0, end), given = /^(.*?)(?::(\d*))?$/.exec(authority.slice(authority.lastIndexOf('@') + 1));
    host = given[1];
    if (given[2]) {
      if (!/^[1-9]\d{0,4}$/.test(given[2]) || Number(given[2]) > 65535) return null;
      if (given[2] !== DEFAULT_PORTS[kind]) port = given[2];
    }
    path = rest.slice(end).replace(/[?#].*$/, '');
  } else {
    const scp = /^(?:[^@/]*@)?([^:/@]+):(.+)$/.exec(value);
    if (!scp || scp[1].length < 2) return null;
    [, host, path] = scp;
  }
  host = host.toLowerCase();
  if (!HOST.test(host)) return null;
  const segments = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  if (segments.length < 2 || !segments.every(segment => SEGMENT.test(segment) && !/^\.+$/.test(segment))) return null;
  const where = port === '' ? host : `${host}:${port}`, name = segments.at(-1), owner = segments.slice(0, -1).join('/'), identity = `${where}/${owner}/${name}`;
  return identity.length <= 512 ? { host: where, owner, name, identity } : null;
}
const IDENTITY = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::([1-9]\d{0,4}))?)((?:\/[\w.+~-]+){2,})$/;
// The parts of a normalized `host[:port]/owner/name` as remoteIdentity returns it, else null.
export function parseIdentity(value) {
  const match = typeof value === 'string' && value.length <= 512 ? IDENTITY.exec(value) : null;
  if (!match || Number(match[2] ?? 0) > 65535 || match[3].endsWith('.git') || match[3].split('/').some(segment => /^\.+$/.test(segment))) return null;
  const segments = match[3].slice(1).split('/');
  return { host: match[1], owner: segments.slice(0, -1).join('/'), name: segments.at(-1) };
}
export const isIdentity = value => parseIdentity(value) !== null;
// Hosted services that fold the case of owner and name; everywhere else case is part of the name. The host always folds.
const CASE_INSENSITIVE_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);
const identityKey = value => { const at = value.indexOf('/'), host = value.slice(0, at).toLowerCase(); return CASE_INSENSITIVE_HOSTS.has(host) ? value.toLowerCase() : `${host}${value.slice(at)}`; };
export const sameIdentity = (a, b) => typeof a === 'string' && typeof b === 'string' && a.includes('/') && b.includes('/') && identityKey(a) === identityKey(b);
// What a person typed for an identity: a remote URL (its credentials dropped) or an already normalized `host[:port]/owner/name`.
export function identityOf(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (isIdentity(text)) return text;
  // `host:port/owner/name` without a scheme would read as scp-like (`host:path`), so it is read as an https identity first.
  const typed = !text.includes('://') && /^[A-Za-z0-9.-]+(?::\d{1,5})?\/[^@\s]*$/.test(text);
  return (typed ? remoteIdentity(`https://${text}`) : remoteIdentity(text) ?? remoteIdentity(`https://${text}`))?.identity ?? null;
}
// ---- Checkout roots ------------------------------------------------------------------------------------------------
export const absoluteRoot = value => plain(value, 1024) && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
const rootKey = root => { const key = root.replaceAll('\\', '/').replace(/\/+$/, ''); return /^(?:[A-Za-z]:|\/\/)/.test(key) ? key.toLowerCase() : key; };
// Whether two spellings name the same folder (drive and UNC paths compare case-insensitively).
export const sameRoot = (a, b) => rootKey(a) === rootKey(b);
// ---- Workspace declaration -----------------------------------------------------------------------------------------
const known = (value, key, max, each) => object(value) && (value.status === 'unresolved' ? only(value, ['status'])
  : value.status === 'known' && only(value, ['status', key]) && list(value[key], max, each, 1));
// JSON pointer (relative to the member) of the first violation of the closed member shape, else null.
export function memberProblem(member) {
  if (!only(member, ['id', 'identity', 'aliases', 'responsibilities', 'instructions', 'contracts'], ['label'])) return '';
  if (!isSlug(member.id)) return '/id';
  if (!isIdentity(member.identity)) return '/identity';
  if (!list(member.aliases, 16, isIdentity) || !sortedUnique(member.aliases) || member.aliases.some(alias => sameIdentity(alias, member.identity))
    || member.aliases.some((alias, index) => member.aliases.slice(0, index).some(earlier => sameIdentity(alias, earlier)))) return '/aliases';
  if (member.label !== undefined && !text(member.label, 120)) return '/label';
  if (!known(member.responsibilities, 'values', 32, value => text(value, 300))) return '/responsibilities';
  if (!known(member.instructions, 'locations', 32, isRepoPath)) return '/instructions';
  if (!known(member.contracts, 'references', 64, value => isRepoPath(value) || isUrn(value))) return '/contracts';
  return null;
}
const provenance = value => only(value, ['kind', 'recordedAt'], ['ref']) && PROVENANCE_KINDS.includes(value.kind)
  && (value.ref === undefined || text(value.ref, 300)) && isUtcTimestamp(value.recordedAt);
// Pointer (relative to the edge) of the first violation of a relationship between declared members, else null.
export function edgeProblem(edge, ids, extra, optional = []) {
  if (!only(edge, ['id', 'from', 'to', 'kind', ...extra], optional)) return '';
  if (typeof edge.id !== 'string' || !/^relationship-[a-f0-9]{32}$/.test(edge.id)) return '/id';
  if (!ids.has(edge.from)) return '/from';
  if (!ids.has(edge.to) || edge.to === edge.from) return '/to';
  if (!RELATIONSHIP_KINDS.includes(edge.kind)) return '/kind';
  if (extra.includes('provenance') && !provenance(edge.provenance)) return '/provenance';
  if (extra.includes('reason') && !text(edge.reason, 300)) return '/reason';
  return null;
}
const edges = (items, base, ids, extra) => {
  if (!Array.isArray(items) || items.length > MAX_RELATIONSHIPS) return base;
  for (const [index, edge] of items.entries()) {
    const problem = edgeProblem(edge, ids, extra);
    if (problem !== null) return `${base}/${index}${problem}`;
    if (index > 0 && !(items[index - 1].id < edge.id)) return `${base}/${index}/id`;
  }
  return null;
};
// JSON pointer (relative to the record) of the first violation of the closed declaration shape, else null.
export function declarationProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'workspace', 'revision', 'members', 'relationships'])) return '';
  if (record.schema !== WORKSPACE_DECLARATION_RECORD_SCHEMA) return '/schema';
  if (record.id !== WORKSPACE_DECLARATION_RECORD_ID) return '/id';
  if (record.required !== false) return '/required';
  const { workspace, members, relationships } = record;
  if (!only(workspace, ['id'], ['label']) || !/^workspace-[a-f0-9]{32}$/.test(workspace.id) || (workspace.label !== undefined && !text(workspace.label, 120))) return '/workspace';
  if (!hash(record.revision)) return '/revision';
  if (!Array.isArray(members) || members.length > MAX_MEMBERS) return '/members';
  for (const [index, member] of members.entries()) {
    const problem = memberProblem(member);
    if (problem !== null) return `/members/${index}${problem}`;
    if (index > 0 && !(members[index - 1].id < member.id)) return `/members/${index}/id`;
  }
  if (!only(relationships, ['status', 'confirmed', 'suggested'])) return '/relationships';
  if (!['unresolved', 'complete'].includes(relationships.status)) return '/relationships/status';
  const ids = new Set(members.map(member => member.id));
  return edges(relationships.confirmed, '/relationships/confirmed', ids, ['provenance']) ?? edges(relationships.suggested, '/relationships/suggested', ids, ['reason']);
}
// One relationship per (from, to, kind): saying it again replaces it.
export const relationshipId = async ({ from, to, kind }) => `relationship-${(await digest({ from, to, kind })).slice(0, 32)}`;
// The id of a new workspace; it is fixed at declare time and never changes after.
export const workspaceId = async ({ label, createdAt }) => `workspace-${(await digest({ label, createdAt })).slice(0, 32)}`;
// The revision covers the workspace identity, members and relationships, so any edit to them is a new revision.
export const workspaceRevision = ({ workspace, members, relationships }) => digest({ workspace, members, relationships });
// Pointer of the first id or revision that does not derive from the record's own fields, else null.
export async function declarationDerivedProblem(record) {
  for (const group of ['confirmed', 'suggested']) for (const [index, edge] of record.relationships[group].entries())
    if (edge.id !== await relationshipId(edge)) return `/relationships/${group}/${index}/id`;
  return record.revision === await workspaceRevision(record) ? null : '/revision';
}
// ---- Observation and local binding ---------------------------------------------------------------------------------
// The Git state both an observation and a binding's observed section carry; pointer relative to that object, else null.
export function stateProblem(state) {
  const { remotes, revision, branch, worktree, workingState } = state;
  if (!list(remotes, 32, remote => only(remote, ['name', 'identity']) && remoteName.test(remote.name) && (remote.identity === null || (remote.name !== UNRECOGNIZED_REMOTE && isIdentity(remote.identity))))
    || !sortedUnique(remotes.map(remote => remote.name))) return '/remotes';
  if (revision !== null && !commitPattern.test(revision)) return '/revision';
  if (branch !== undefined && !plain(branch, 255)) return '/branch';
  if (!only(worktree, ['kind', 'gitDirSha256']) || !['main', 'linked'].includes(worktree.kind) || !hash(worktree.gitDirSha256)) return '/worktree';
  if (!only(workingState, ['clean', 'sha256']) || typeof workingState.clean !== 'boolean' || !hash(workingState.sha256)) return '/workingState';
  return null;
}
// JSON pointer of the first violation of the closed observation shape a host reports for one checkout, else null.
export function observationProblem(observation) {
  if (!only(observation, ['root', 'remotes', 'revision', 'worktree', 'workingState', 'observedAt'], ['branch'])) return '';
  if (!absoluteRoot(observation.root)) return '/root';
  return stateProblem(observation) ?? (isUtcTimestamp(observation.observedAt) ? null : '/observedAt');
}
// JSON pointer (relative to the record) of the first violation of the closed local-binding shape, else null.
export function bindingProblem(record) {
  if (!only(record, ['id', 'schema', 'required', 'workspace', 'member', 'checkout', 'observed', 'verification'], ['replaces'])) return '';
  if (record.schema !== LOCAL_BINDING_RECORD_SCHEMA) return '/schema';
  if (typeof record.id !== 'string' || !/^binding-[a-f0-9]{32}$/.test(record.id)) return '/id';
  if (record.required !== false) return '/required';
  if (!only(record.workspace, ['id', 'revision']) || !/^workspace-[a-f0-9]{32}$/.test(record.workspace.id) || !hash(record.workspace.revision)) return '/workspace';
  if (!only(record.member, ['id', 'identity']) || !isSlug(record.member.id) || !isIdentity(record.member.identity)) return '/member';
  if (!only(record.checkout, ['root']) || !absoluteRoot(record.checkout.root)) return '/checkout';
  const { observed, verification } = record;
  if (!only(observed, ['repository', 'remotes', 'revision', 'worktree', 'workingState'], ['branch']) || (observed.repository !== null && !isIdentity(observed.repository))) return '/observed';
  const state = stateProblem(observed);
  if (state !== null) return `/observed${state}`;
  if (!only(verification, ['result', 'reasons', 'verifiedAt']) || !['matched', 'confirmed'].includes(verification.result)
    || !list(verification.reasons, BINDING_REASONS.length, reason => BINDING_REASONS.includes(reason)) || !sortedUnique(verification.reasons)
    || (verification.result === 'matched') !== (verification.reasons.length === 0) || !isUtcTimestamp(verification.verifiedAt)) return '/verification';
  if (record.replaces !== undefined && (typeof record.replaces !== 'string' || !/^binding-[a-f0-9]{32}$/.test(record.replaces))) return '/replaces';
  return null;
}
// One binding per (workspace, member, checkout root); a different worktree has a different root and so its own binding.
export const bindingId = async ({ workspaceId: workspace, memberId, root }) => `binding-${(await digest({ workspace, member: memberId, root })).slice(0, 32)}`;
export async function bindingDerivedProblem(record) {
  return record.id === await bindingId({ workspaceId: record.workspace.id, memberId: record.member.id, root: record.checkout.root }) ? null : '/id';
}
