import { el } from '../app/dom.js';
import { iconFor, iconSpan } from '../app/icons.js';
import { attachTooltip } from '../app/tooltip.js';
import { copiesWords } from '../app/tool-host-warnings.js';
import { mcpApprovalView } from '../app/mcp-approval.js';
export function badge(group, key, words, explanation) {
  const node = el('span', 'browse-fact'); node.append(iconSpan(group, key), el('span', '', words));
  node.addEventListener('click', event => event.stopPropagation());
  node.dataset.fact = group; node.dataset.state = key;
  attachTooltip(node, explanation || words); return node;
}
export function itemBrowseFacts(item, browse, tool) {
  const fit = browse?.compatibility?.items?.find(value => value.item.itemId === item.id);
  const scan = browse?.scans?.find(value => value.itemId === item.id);
  const recipe = browse?.recipes?.find(value => value.itemId === item.id);
  const observed = fit?.observedOn;
  const host = browse?.host;
  const blocked = fit?.support === 'none' || fit?.notRendered || fit?.staticBlockers?.length;
  let fitKey = blocked ? 'none' : observed ? fit.observed : 'unconfirmed';
  let words = blocked ? `Doesn’t work in ${tool?.label ?? 'this tool'}` : observed ? `Observed in ${tool?.label ?? 'this tool'}` : 'Not yet confirmed';
  if (!fit) words = browse?.status === 'failed' ? 'Tool fit failed' : browse?.status ? 'Tool fit unavailable' : 'Tool fit loading';
  if (fit?.boundAs) { fitKey = 'fallback'; words = `Installed as a ${fit.boundAs.kind} in ${tool?.label ?? 'this tool'}`; }
  const explanation = !fit ? (browse?.reason ?? 'Tool fit is loading or unavailable. Choose your tool; no successful use is assumed.') : `${fit.reason} ${fit.notRendered?.detail ?? ''} ${(fit.staticBlockers ?? []).map(value => value.detail).join(' ')} ${observed ? `Observed ${observed.observedAt}, ${observed.os} ${observed.arch}, tool ${observed.toolVersion}.` : `No observation on ${browse.platform?.os ?? 'unknown OS'} ${browse.platform?.arch ?? 'unknown architecture'}.`} A fallback label describes the published binding, not an installed-file check. Host facts ${host?.status ?? 'unchecked'}; static observation is not proof of use here.`;
  return { fit, scan, recipe, fitKey, words, explanation };
}
export function renderBrowseFacts(item, browse, tool, { detailed = false, onApprove = undefined, approved = false, approvalError = undefined } = {}) {
  const node = el('div', 'browse-facts'); const facts = itemBrowseFacts(item, browse, tool);
  node.append(badge('fit', facts.fitKey, facts.words, facts.explanation));
  if (item.payload?.invocation === 'user-only') node.append(badge('state', 'on-request', 'Only when you ask', 'Invocation is declared by this Catalog item.'));
  const summary = facts.scan?.summary;
  if (summary) {
    const label = iconFor('scan', summary.state).label;
    node.append(badge('scan', summary.state, label, `${label}. ${summary.why ?? 'Scan’s evidence-policy decision.'} ${summary.scannedAt ?? 'No assessment date.'} This is evidence, not installation authority.`));
  } else node.append(badge('scan', 'not-scanned', facts.scan?.status === 'invalid' || browse?.status === 'failed' ? 'Scan summary failed' : browse?.status ? 'Scan summary unavailable' : 'Scan summary loading', facts.scan?.diagnostics?.map(value => value.detail).join(' ') ?? 'The item summary has not been read. No Verified claim is made.'));
  const size = facts.fit?.deliveredSize;
  const value = size ? `Every session: ${size.alwaysLoaded.bytes} bytes · ${size.alwaysLoaded.chars} chars; when used: ${size.bytes} bytes · ${size.chars} chars` : 'Size unknown';
  node.append(badge('state', 'size', value, value + '. Harness delivered size; not a token estimate or measured model usage.'));
  if (item.hints?.tools?.length) node.append(badge('state', 'info', `Written for ${item.hints.tools.join(', ')}`, 'Producer-declared display hints; not tool support or a binding.'));
  if (item.variantOf) node.append(badge('state', 'info', `Variant of ${item.variantOf.itemId ?? JSON.stringify(item.variantOf)}`, JSON.stringify(item.variantOf)));
  const isMcp = item.kind === 'mcp-server' || item.kind === 'mcp';
  if (facts.fit?.permissionStep && !isMcp) node.append(badge('state', 'needs-ok', facts.fit.permissionStep, facts.fit.permissionStep));
  // One MCP server's own approval row: the tick is off by default, exists only when Core can write this
  // tool's one-server approval, and never carries an input value (#162).
  const approval = mcpApprovalView(item, facts.fit, browse, tool);
  if (approval.state === 'checked') {
    const row = el('label', 'browse-mcp-approval flex items-start gap-x-2 text-on-surface');
    row.dataset.mcpApproval = approval.approvable ? 'offered' : 'in-tool';
    // The box reflects the artifact: after a tick/untick the card re-renders, and a hardcoded false
    // would silently drop the person's choice (their next click would toggle the wrong way).
    const box = el('input', 'mt-0.5'); box.type = 'checkbox'; box.checked = Boolean(approved);
    box.disabled = !approval.approvable || typeof onApprove !== 'function';
    box.dataset.server = item.id; box.setAttribute('aria-label', `${approval.words} (${item.id})`);
    // The needs-you state keeps the existing amber semantic token (S1): offered rows use the same tone
    // as the needs-ok badge; no new palette.
    row.append(box, el('span', approval.approvable ? 'text-tertiary' : '', `${approval.words}. ${approval.requirements}`));
    attachTooltip(row, approval.reason);
    const error = el('p', 'text-error text-[11px]', approvalError ?? ''); error.dataset.approvalError = item.id; error.setAttribute('role', 'alert'); error.hidden = !approvalError;
    if (approval.approvable && typeof onApprove === 'function') box.addEventListener('change', async () => {
      const requested = box.checked, recorded = Boolean(approved);
      box.disabled = true; error.hidden = true; error.textContent = '';
      try { await onApprove(item, requested); }
      catch (thrown) { box.checked = recorded; error.textContent = thrown.message; error.hidden = false; }
      finally { box.disabled = false; }
    });
    node.append(row, error);
  } else if (approval.state !== 'empty') node.append(badge('state', 'needs-ok', approval.words, approval.words));
  // What the host inspection saw about a second copy, exactly as Core reported it (#163). The badge appears
  // for inspected (chosen) items and for any item Core named in a warning; unchosen items were not checked
  // and carry no line. The drawer states the global couldn't-check wording.
  const inspected = browse?.host?.items?.some(hostItem => hostItem.itemId === item.id) ?? false;
  const warned = (browse?.host?.warnings ?? []).some(warning => warning.code === 'same-key-elsewhere' && warning.item?.itemId === item.id);
  // An unavailable host answer is said per chosen item, never implied clean (Q6).
  const artifactChosen = (browse?.chosenItemIds ?? []).includes(item.id);
  if (!inspected && !warned && artifactChosen && browse?.host && !['read', 'checked'].includes(browse.host.status))
    node.append(badge('state', 'not-reported', `Couldn't check whether your tool already has ${item.id}${browse.host.reason ? `: ${browse.host.reason}` : '.'}`,
      'Read-only Core host inspection did not run for this item; no second-copy claim is made either way.'));
  if (inspected || warned) node.append(badge('state', 'two-copies', copiesWords(browse?.host, item.id, { chosen: inspected }),
    'Read-only Core host inspection of your project folder. No client was launched; the Workbench does not decide what counts as a duplicate.'));
  if (facts.recipe && !facts.recipe.available) node.append(badge('state', 'info', 'Can’t be added yet', facts.recipe.reason));
  const policy = browse?.policy?.find(value => value.itemId === item.id)?.preview;
  if (browse?.enterprise && !policy) node.append(badge('state', 'policy', browse.status === 'failed' ? 'Organization policy failed' : browse.status ? 'Organization policy unavailable' : 'Organization policy loading', 'An organization preference grants no authority. The badge waits for Core’s preview over the host-configured source.'));
  if (policy) node.append(badge('state', 'policy', policy.status === 'ok' ? `Organization policy · ${policy.value.enforced.admitted ? 'advisory preview' : 'blocked'}` : 'Organization policy unavailable', JSON.stringify(policy)));
  if (detailed) node.append(renderFrameworkRoutes(facts.fit?.item.framework, browse, tool, { inspector: true }));

  if (detailed) {
    const observedHost = browse?.host;
    const version = observedHost?.installedVersion;
    const hostWords = version?.state === 'known' ? `Tool version ${version.version}, read from local files.` : `Tool version unchecked: ${version?.reason ?? observedHost?.reason ?? observedHost?.status ?? 'not inspected'}.`;
    const host = el('p', 'browse-host-facts', `${hostWords} No client was launched. Host reads do not prove successful use.`);
    node.append(host);
    const observations = browse?.observations?.find(value => value.itemId === item.id)?.observations;
    if (observations?.length) {
      const prior = el('details'); prior.append(el('summary', '', 'Published observations, including other platforms'), el('pre', 'browse-json', JSON.stringify(observations, null, 2))); node.append(prior);
    }
    const raw = el('details'); raw.append(el('summary', '', 'Exact tool fit and host observations'), el('pre', 'browse-json', JSON.stringify({ platform: browse?.platform, compatibility: facts.fit, pluginRoutes: browse?.compatibility?.pluginRoutes, routeRefusal: [...(browse?.compatibility?.checks ?? []), browse?.compatibility?.setCheck].find(value => value?.status === 'refused' && value.reason === 'native-routes'), host: browse?.host }, null, 2))); node.append(raw);
  }
  return node;
}

export function renderFrameworkRoutes(frameworkId, browse, tool, { inspector = false } = {}) {
  const node = el('div', 'browse-facts');
  if (!inspector) node.id = 'framework-plugin-routes';
  const refusedRoutes = [...(browse?.compatibility?.checks ?? []), browse?.compatibility?.setCheck].find(value => value?.status === 'refused' && value.reason === 'native-routes');
  const routes = browse?.compatibility?.pluginRoutes?.find(value => value.framework === frameworkId);
  const routeState = refusedRoutes ? 'refused' : routes?.state ?? (browse?.status === 'failed' ? 'failed' : browse?.status ? 'unavailable' : 'loading');
  node.dataset.pluginRoutes = routeState;
  const routeNote = 'Display-only guidance from public Harness compatibility over the checked Catalog release. AIH does not run it; this says nothing about installation, activation, permission, observation or successful use.';
  if (routeState === 'listed') for (const line of routes.lines) node.append(badge('state', 'info', `Also available as ${tool?.label ?? 'this tool'}'s own plugin: ${line}. AIH doesn't run it.`, routeNote));
  else if (routeState !== 'not-listed') {
    const label = routeState === 'not-supplied' ? 'Plugin routes not supplied' : routeState === 'refused' ? 'Plugin route check refused' : routeState === 'failed' ? 'Plugin routes failed' : routeState === 'loading' ? 'Plugin routes loading' : 'Plugin routes unavailable';
    node.append(badge('state', 'info', label, refusedRoutes ? JSON.stringify(refusedRoutes) : `${routeNote} ${routeState === 'not-supplied' ? 'No route lines were supplied for this framework.' : 'No published route result is available.'}`));
  }

  return node;
}
