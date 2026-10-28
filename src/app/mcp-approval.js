// An MCP server's permission step and its one-server approval, from Harness compatibility and the public
// tool binding alone (#162). Core alone knows whether the approval write exists for this tool; the page
// never guesses it. Input values are never touched here — the tick is a choice about one server, not data.

/**
 * The card/inspector view of one MCP item's approval. state: 'empty' (not an MCP item, or Core published no
 * permission need), 'loading', 'unavailable', 'failed', 'checked'. When checked, `approvable` says whether
 * Core can write this tool's one-server approval; otherwise the person is told to approve in the tool and no
 * tick is offered. `requirements` is Harness's permissionStep wording, verbatim.
 */
export function mcpApprovalView(item, fit, browse, tool) {
  const kind = item?.kind;
  if (kind !== 'mcp-server' && kind !== 'mcp') return { state: 'empty' };
  const label = tool?.label ?? 'your tool';
  if (!fit) {
    if (!browse || browse.status === undefined) return { state: 'loading', words: `Checking what ${label} needs…` };
    if (browse.status === 'failed') return { state: 'failed', words: `Couldn't check what ${label} needs. ${browse.reason ?? ''}`.trim() };
    return { state: 'unavailable', words: `Couldn't check what ${label} needs. ${browse.reason ?? 'Tool fit is unavailable.'}` };
  }
  if (!fit.permissionStep) return { state: 'empty' };
  const approvable = browse?.approvalShape != null && browse.approvalShape !== 'other';
  if (!approvable) return { state: 'checked', approvable: false,
    words: `Approve in ${label} instead`,
    requirements: fit.permissionStep,
    reason: `Core cannot write ${label}'s approval for one server. ${fit.permissionStep}` };
  return { state: 'checked', approvable: true,
    words: `Still needs your OK in ${label}`,
    requirements: fit.permissionStep,
    reason: `${fit.permissionStep} Tick to allow exactly this one server; it is off until you choose it.` };
}

/**
 * The exact one-server opt-in as a public Harness delivery render: `grantApproval` names the one MCP server
 * item being rendered, never a list. Returns Core's own answer — a rendered recipe whose one approval
 * operation allows that server, or Core's refusal (e.g. approval-shape-unsupported, whose guidance says to
 * approve in the tool). No input value is accepted or stored here.
 */
export async function approveOneServer(renderDelivery, request) {
  const granted = request?.grantApproval;
  if (!granted || Object.keys(granted).length !== 2 || typeof granted.framework !== 'string' || typeof granted.itemId !== 'string')
    throw new Error('Name the one MCP server to allow as { framework, itemId }; there is no list or approve-all.');
  return renderDelivery(request);
}
