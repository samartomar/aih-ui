// The one Enterprise statement of whether the organization policy was read, from the host's browse answer
// (`organizationPolicy`, tools/consumer/server.mjs) and the saved setup. The policy repository in setup is a saved
// reference; only the host-configured organization authority source is ever read (docs/authoring.md).
import { sourceRows } from '../app/authority-source.js';

const WHERE = 'set AIH_ORGANIZATION_SOURCE to a host JSON file naming the repository, or a local organization policy file, and restart the Workbench';

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
  if (answer.status === 'not-configured') {
    const repo = settings?.organization?.policyRepo;
    return { state: 'not-configured', text: `Organization policy not read. No organization authority source is configured by the host. Enterprise policies cannot be admitted until one is.${repo ? ` Your policy repository ${repo} is saved as a reference; no repository is connected.` : ''} To read it, ${WHERE}.` };
  }
  const rows = sourceRows(answer.source), from = rows.repository ?? rows.path ?? 'the host-configured source';
  const reason = answer.diagnostics?.[0]?.reason, file = rows.repository ? `${rows.repository} ${rows.path} (${rows.ref})` : from;
  if (reason === 'source-missing-or-inaccessible') return { state: 'not-found', text: `Organization policy not found: ${file} does not have it, or the host cannot see it. Check the file path and branch.` };
  if (reason === 'authentication-required-or-denied') return { state: 'no-access', text: `Organization policy: no access to ${rows.repository ?? from}. Give the host read access in its controls file (AIH_CONSUMER_CONTROLS), then restart the Workbench.` };
  const why = (answer.diagnostics ?? []).map(value => [value.message, value.code ?? value.reason].filter(Boolean).join(' ')).join(' ') || 'Core gave no reason.';
  return { state: answer.status, text: `Organization policy couldn’t be read from ${from}: ${why} Check that the host can reach it and that the host controls file (AIH_CONSUMER_CONTROLS) gives read access, or ${WHERE}.` };
}
