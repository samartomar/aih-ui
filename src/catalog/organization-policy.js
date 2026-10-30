// The one Enterprise statement of whether the organization policy was read, from the host's browse answer
// (`organizationPolicy`, tools/consumer/server.mjs) and the saved setup. The policy repository in setup is a saved
// reference; only the host-configured organization authority source is ever read (docs/authoring.md).
import { sourceRows } from '../app/authority-source.js';

const WHERE = 'set AIH_ORGANIZATION_SOURCE to a host JSON file naming the repository, or a local organization policy file, and restart the Workbench';

export function organizationPolicyNotice(answer, settings) {
  if (!answer) return null;
  const admin = settings?.role === 'admin';
  const still = admin ? ' As an admin you can still add and install content; it is not checked against an organization policy.' : '';
  if (answer.status === 'ok') {
    const rows = sourceRows(answer.source), from = rows.repository ? `${rows.repository} ${rows.path ?? ''}`.trim() : rows.path ?? 'the host-configured source';
    return { state: 'ok', text: `Organization policy ${answer.policyId} read from ${from}. Cards show Core’s advisory preview; it grants no authority.` };
  }
  if (answer.status === 'not-configured') {
    const repo = settings?.organization?.policyRepo;
    return { state: 'not-configured', text: `Organization policy not read. No organization authority source is configured by the host. Enterprise policies cannot be admitted until one is.${repo ? ` Your policy repository ${repo} is saved as a reference; no repository is connected.` : ''} To read it, ${WHERE}.${still}` };
  }
  const rows = sourceRows(answer.source), from = rows.repository ?? rows.path ?? 'the host-configured source';
  const why = (answer.diagnostics ?? []).map(value => [value.message, value.code ?? value.reason].filter(Boolean).join(' ')).join(' ') || 'Core gave no reason.';
  return { state: answer.status, text: `Organization policy couldn’t be read from ${from}: ${why} Check that the host can reach it and that the host controls file (AIH_CONSUMER_CONTROLS) gives read access, or ${WHERE}.${still}` };
}
