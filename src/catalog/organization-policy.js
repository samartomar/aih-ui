// The one Enterprise statement of whether the organization policy was read, from the host's browse answer
// (`organizationPolicy`, tools/consumer/server.mjs) and the saved setup, and the Admin authority-source panel's words
// for the same states. The policy repository in setup is a saved reference; only the host-configured organization
// authority source is ever read (docs/authoring.md).
// Host configuration (AIH_ORGANIZATION_SOURCE, the controls file) is named only in the README, never on the page.
import { sourceRows } from '../app/authority-source.js';
import { coreSentence } from '../app/core-words.js';

const NO_ACCESS = 'Give the Workbench host read access to the repository, then try again.';
const ASK_HOST = 'Ask whoever runs this Workbench to check the policy file.';
const NOT_VALID = "The policy file isn't a valid organization policy.";
const NOT_CONNECTED = "Organization policy not read. No organization policy is connected, so Enterprise policies can't be admitted. Add your organization's policy repository in setup, or ask whoever runs this Workbench to connect a local policy file.";
// The repositories the host can connect (tools/consumer/organization-source.mjs, repositoryOf).
const GITHUB_REPOSITORY = /^(?:https:\/\/)?github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?(?:\.git)?\/?$/;
const sentences = diagnostics => (diagnostics ?? []).map(value => coreSentence(value.message)).filter(Boolean).join(' ');

// What to do about a read that failed: fix a file that is not a valid policy, ask the host about a local file, or give
// the host read access to a GitHub repository.
function nextStep(status, local) {
  if (status === 'invalid') return local ? `${NOT_VALID} ${ASK_HOST}` : `${NOT_VALID} Fix it in the repository, then try again.`;
  return local ? ASK_HOST : NO_ACCESS;
}

/** No source is connected: say why, from the policy repository saved in setup, and what to do. */
export function notConnectedWords(policyRepo, { asked = false } = {}) {
  const repo = typeof policyRepo === 'string' ? policyRepo.trim() : '';
  if (!repo) return NOT_CONNECTED;
  if (!GITHUB_REPOSITORY.test(repo)) return `Organization policy not read. The Workbench reads policy repositories on GitHub only, and ${repo} isn't one. Save a GitHub repository in setup, or ask whoever runs this Workbench to connect a local policy file.`;
  // The catalog asks once for the policy file in a saved GitHub repository; elsewhere the page points there.
  if (asked) return `Organization policy not read yet. Name the policy file in ${repo} and its branch in the catalog, and the Workbench reads it from GitHub. Enterprise policies cannot be admitted until it is read.`;
  // A GitHub repository the host did not ask about: it could not read the saved setup.
  return `Organization policy not read. The Workbench host couldn't read the saved setup, so it can't ask for the policy file in ${repo}. Save your setup again, or ask whoever runs this Workbench to connect a local policy file.`;
}

/** A read that failed, in plain words with what to do: not found, no access, or Core's reason sentence and the fix. */
export function readFailureWords(answer) {
  const rows = sourceRows(answer.source), from = rows.repository ?? rows.path ?? 'the host-configured source';
  const local = answer.source?.provider === 'local' || !rows.repository;
  const reason = answer.diagnostics?.[0]?.reason, file = `${rows.repository} ${rows.path} (${rows.ref})`;
  if (!local && reason === 'source-missing-or-inaccessible') return { state: 'not-found', text: `Organization policy not found: ${file} does not have it, or the host cannot see it. Check the file path and branch.` };
  if (!local && reason === 'authentication-required-or-denied') return { state: 'no-access', text: `Organization policy: no access to ${rows.repository}. ${NO_ACCESS}` };
  const why = sentences(answer.diagnostics);
  return { state: answer.status, text: `Organization policy couldn’t be read from ${from}${why ? `: ${why}` : '.'} ${nextStep(answer.status, local)}` };
}

/** The asked-once form's answer: read, not found, no access, or Core's reason sentence, always with what to do. */
export function sourceAnswerWords(answer) {
  if (answer.status === 'read') return `Read the organization policy ${answer.policyId}.`;
  if (answer.status === 'not-found') return 'Not found. Check the file path and branch.';
  if (answer.status === 'no-access') return `No access. ${NO_ACCESS}`;
  const why = sentences(answer.diagnostics);
  // The host's own refusals of the two values are sentences that say what to change.
  if (answer.status === 'refused') return why || 'Not read. Check the file path and branch, then try again.';
  return `${why || 'Not read.'} ${nextStep(answer.status, false)}`;
}

export function organizationPolicyNotice(answer, settings) {
  if (!answer) return null;
  if (answer.status === 'ok') {
    const rows = sourceRows(answer.source), from = rows.repository ? `${rows.repository} ${rows.path ?? ''}`.trim() : rows.path ?? 'the host-configured source';
    return { state: 'ok', text: `Organization policy read: ${answer.policyId} from ${from}. Cards show Core’s advisory preview; it grants no authority.` };
  }
  if (answer.status === 'not-configured' && answer.request) {
    // The host can connect the setup's policy repository: the page asks once for the file and branch.
    return { state: 'not-configured', request: answer.request,
      text: `Organization policy not read yet. Name the policy file in ${answer.request.repository} and its branch, and the Workbench reads it from GitHub. Enterprise policies cannot be admitted until it is read.` };
  }
  // Row 50 only when setup saves no policy repository; a saved one the host cannot ask about says why.
  if (answer.status === 'not-configured') return { state: 'not-configured', text: notConnectedWords(settings?.organization?.policyRepo) };
  return readFailureWords(answer);
}
