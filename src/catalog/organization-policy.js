// The one Enterprise statement of whether the organization policy was read, from the host's browse answer
// (`organizationPolicy`, tools/consumer/server.mjs) and the saved setup. The policy repository in setup is a saved
// reference; only the host-configured organization authority source is ever read (docs/authoring.md).
// Host configuration (AIH_ORGANIZATION_SOURCE, the controls file) is named only in the README, never on the page.
import { sourceRows } from '../app/authority-source.js';
import { coreSentence } from '../app/core-words.js';

const NO_ACCESS = 'Give the Workbench host read access to the repository, then try again.';
const NOT_CONNECTED = "Organization policy not read. No organization policy is connected, so Enterprise policies can't be admitted. Add your organization's policy repository in setup, or ask whoever runs this Workbench to connect a local policy file.";
const sentences = diagnostics => (diagnostics ?? []).map(value => coreSentence(value.message)).filter(Boolean).join(' ');

/** The asked-once form's answer: read, not found, no access, or Core's reason sentence. */
export function sourceAnswerWords(answer) {
  if (answer.status === 'read') return `Read the organization policy ${answer.policyId}.`;
  if (answer.status === 'not-found') return 'Not found. Check the file path and branch.';
  if (answer.status === 'no-access') return `No access. ${NO_ACCESS}`;
  return sentences(answer.diagnostics) || 'Not read. Core gave no reason.';
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
  // With a policy repository saved in setup, the asked-once form above is the only note.
  if (answer.status === 'not-configured') return settings?.organization?.policyRepo ? null : { state: 'not-configured', text: NOT_CONNECTED };
  const rows = sourceRows(answer.source), from = rows.repository ?? rows.path ?? 'the host-configured source';
  const reason = answer.diagnostics?.[0]?.reason, file = rows.repository ? `${rows.repository} ${rows.path} (${rows.ref})` : from;
  if (reason === 'source-missing-or-inaccessible') return { state: 'not-found', text: `Organization policy not found: ${file} does not have it, or the host cannot see it. Check the file path and branch.` };
  if (reason === 'authentication-required-or-denied') return { state: 'no-access', text: `Organization policy: no access to ${rows.repository ?? from}. ${NO_ACCESS}` };
  const why = sentences(answer.diagnostics);
  return { state: answer.status, text: `Organization policy couldn’t be read from ${from}${why ? `: ${why}` : '.'} ${NO_ACCESS}` };
}
