// The host-side step that connects an Enterprise setup's policy repository to the organisation source this host reads.
// The page names only the policy file's path and branch. The repository is the saved setup's `policyRepo`, the host saves
// { provider: 'github', repository, path, revision } beside the setup file as its configured source, and Core's GitHub
// reader reads it with the authentication the host controls file (AIH_CONSUMER_CONTROLS) holds. No token is stored here
// or returned. A source the host configuration names (AIH_ORGANIZATION_SOURCE) is never replaced.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { organizationSourceProblem } from './organization-draft-record.mjs';
import { readOrganization } from './authority-source.mjs';

export const SAVED_SOURCE_FILE = 'organization-source.json';
export const savedSourcePath = setupSettingsPath => join(dirname(setupSettingsPath), SAVED_SOURCE_FILE);

// github.com/owner/name or https://github.com/owner/name(.git); Core's reader speaks GitHub only.
export function repositoryOf(policyRepo) {
  const match = /^(?:https:\/\/)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(String(policyRepo ?? '').trim());
  return match ? { owner: match[1], name: match[2] } : null;
}

function readSetup(setupSettingsPath) {
  try { return setupSettingsPath ? JSON.parse(readFileSync(setupSettingsPath, 'utf8')) : null; } catch { return null; }
}

/** The source this host saved earlier, if any and well formed. */
export function readSavedSource(setupSettingsPath) {
  if (!setupSettingsPath) return undefined;
  try {
    const source = JSON.parse(readFileSync(savedSourcePath(setupSettingsPath), 'utf8'));
    return organizationSourceProblem(source) === null ? source : undefined;
  } catch { return undefined; }
}

// What the page asks for, with the defaults the organisation author's export produces (its file name and branch).
function requestOf(setup) {
  const repository = setup?.experience === 'enterprise' ? repositoryOf(setup.organization?.policyRepo) : null;
  if (!repository) return null;
  const shortId = setup.organization?.shortId;
  return { repository: `${repository.owner}/${repository.name}`, path: `${/^[\w.-]{1,64}$/.test(shortId ?? '') ? shortId : 'organization'}.organization-policy.json`, branch: 'main' };
}

// The read state in words the page can show: read, not found, no access, or Core's own reason.
async function stateOf(source, controls) {
  const result = await readOrganization({ organizationSource: source, controls });
  const page = { provider: 'github', repository: source.repository, path: source.path, revision: source.revision };
  if (result.status === 'ok') return { status: 'read', source: page, policyId: result.organization.id };
  const diagnostic = result.diagnostics?.[0] ?? {};
  const status = diagnostic.reason === 'authentication-required-or-denied' ? 'no-access' : diagnostic.reason === 'source-missing-or-inaccessible' ? 'not-found'
    : result.status === 'invalid' ? 'invalid' : 'unreadable';
  return { status, source: page, diagnostics: (result.diagnostics ?? []).map(({ code, reason, message }) => ({ code, reason, message })) };
}

/**
 * The step itself. With no path, it reports the state: the configured source's, or what the page should ask for. With a
 * path and branch, it reads that file in the setup's repository and saves it as the host's source unless it is not found.
 * Returns { answer, source } where `source` is the newly configured source, when one was saved.
 */
export async function organizationSourceStep({ body, setupSettingsPath, configured, fixed, controls }) {
  const refused = message => ({ answer: { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message }] } });
  const wantsSave = body && typeof body.path === 'string';
  if (!wantsSave) {
    if (configured) return { answer: configured.provider === 'github' ? await stateOf(configured, controls) : { status: 'configured', source: { provider: configured.provider } } };
    const request = requestOf(readSetup(setupSettingsPath));
    return { answer: request ? { status: 'not-configured', request } : { status: 'not-configured' } };
  }
  if (fixed) return refused('The host configuration (AIH_ORGANIZATION_SOURCE) names the organisation source; change it there and restart the Workbench.');
  const request = requestOf(readSetup(setupSettingsPath));
  if (!request) return refused('The saved setup names no GitHub policy repository for an Enterprise setup.');
  const [owner, name] = request.repository.split('/');
  const source = { provider: 'github', repository: { owner, name }, path: body.path, revision: { kind: 'branch', value: typeof body.branch === 'string' ? body.branch : '' } };
  if (organizationSourceProblem(source) !== null) return refused('Name a .json file in the repository and a branch, with no spaces or special characters.');
  const answer = await stateOf(source, controls);
  // A file that is not there is asked for again; one read, or one the host's credentials cannot reach yet, is kept.
  if (answer.status === 'not-found') return { answer };
  const target = savedSourcePath(setupSettingsPath), temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  return { answer, source };
}

export const hasSavedSource = setupSettingsPath => Boolean(setupSettingsPath) && existsSync(savedSourcePath(setupSettingsPath));
