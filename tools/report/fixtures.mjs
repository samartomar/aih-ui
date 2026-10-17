// Report snapshots for the renderer's checks. `workflow-snapshot.json` is the snapshot Core's packed
// reporting workflow produced (Core examples/reporting/workflow/report.json; its exported form is the one
// Core's visual evidence was recorded from). The variants derived from it reach every branch the renderer
// draws: each check outcome, each tool state worth a review item, a diagnostic, a status other than
// completed, a supplied original digest and text that must be escaped.
import { readFileSync } from 'node:fs';

export const WORKFLOW_SNAPSHOT_TEXT = readFileSync(new URL('./fixtures/workflow-snapshot.json', import.meta.url), 'utf8');

const counts = checks => Object.fromEntries(['passed', 'failed', 'unavailable', 'skipped'].map(outcome => [outcome, checks.filter(check => check.outcome === outcome).length]));

function findings(base) {
  const hostile = `line${String.fromCharCode(0x2028)}break` + ' </script><b>bold</b> & "quoted" \'single\'';
  const checks = [...base.checks,
    { id: 'npm-registry', target: 'npm', outcome: 'failed', reason: 'tls-untrusted', detail: `certificate chain not trusted ${hostile}` },
    { id: 'git-remote', target: 'git', outcome: 'unavailable', reason: 'timeout', detail: 'the probe did not answer within its budget' },
    { id: 'python-version', target: 'python', outcome: 'skipped', reason: 'not-selected', detail: 'python was not requested' }];
  const tools = base.tools.map((tool, index) => index === 0 ? { ...tool, state: 'broken', selection: 'requested' }
    : index === 1 ? { ...tool, state: 'absent', selection: 'requested' }
      : index === 2 ? { ...tool, state: 'config-only', selection: 'detected', config: 'settings.json' }
        : index === 3 ? { ...tool, state: 'binary', selection: 'detected' } : tool);
  return { ...base, capture: { ...base.capture, acquisition: 'supplied' }, evidence: { ...base.evidence, originalSha256: 'a'.repeat(64) },
    checks, tools, diagnostics: [{ code: 'PROBE_LIMIT', reason: 'budget', message: `one probe was stopped ${hostile}` }],
    metrics: { ...base.metrics, counts: counts(checks) } };
}

/** Named snapshot values: the workflow snapshot and its variants. */
export function reportSnapshots() {
  const base = JSON.parse(WORKFLOW_SNAPSHOT_TEXT);
  const failing = findings(base);
  return {
    workflow: base,
    findings: failing,
    cancelled: { ...failing, status: 'cancelled' },
    'no-checks': { ...base, checks: [], tools: [], observations: [], metrics: { ...base.metrics, counts: counts([]) } },
  };
}
