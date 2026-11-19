// Preserve the policy's independent source and content rules. Core enforces the
// explicit framework boundary, including unknown frameworks and an empty list.
export function policyPosture(policy) {
  return Array.isArray(policy?.sources?.frameworks) || policy?.entries?.some(entry => typeof entry.content?.framework === 'string' && entry.id === 'workbench-only-framework-' + entry.content.framework) ? 'only-selected' : 'catalog-default';
}
export function buildPolicyDraft(previous, body, catalog, changeIdentity) {
  const frameworkEntry = entry => typeof entry.content?.framework === 'string' && entry.id === 'catalog-framework-' + entry.content.framework;
  const itemEntry = entry => typeof entry.content?.item === 'string' && entry.id === 'workbench-item-' + entry.content.item;
  const kindEntry = entry => typeof entry.content?.kind === 'string' && entry.id === 'workbench-kind-' + entry.content.kind;
  body = {...body,
    frameworkRules:body.frameworkRules ?? Object.fromEntries((previous?.entries || []).filter(frameworkEntry).map(entry => [entry.content.framework,entry.obligation])),
    itemRules:body.itemRules ?? Object.fromEntries((previous?.entries || []).filter(itemEntry).map(entry => [entry.content.item,entry.obligation])),
    kindRules:body.kindRules ?? Object.fromEntries((previous?.entries || []).filter(kindEntry).map(entry => [entry.content.kind,entry.obligation]))};
  const owned = entry => entry.id === 'superpowers-framework' && entry.content?.framework === 'superpowers' || entry.id === 'project-instructions' && typeof entry.change?.identity === 'string' ||
    typeof entry.content?.framework === 'string' && entry.id === 'workbench-only-framework-' + entry.content.framework || frameworkEntry(entry) || itemEntry(entry) || kindEntry(entry);
  const edit = defaults => {
    const existing = previous?.entries.find(entry => entry.id === defaults.id);
    // The editor changes only the obligation. Imported target narrowing, change
    // identity, input restrictions and lifecycle permissions remain authoritative.
    return existing ? owned(existing) ? {...existing,obligation:defaults.obligation} : null : defaults;
  };
  const policy = { ...(previous || {}), schema:'urn:aihq:core:organization:0.1.0', id:body.id,
    entries:[...(previous?.entries || []).filter(entry => !owned(entry)),
      edit({id:'superpowers-framework',obligation:body.obligation,scopes:['project'],clients:['claude-code'],content:{framework:'superpowers'}}),
      edit({id:'project-instructions',obligation:body.allowCustom?'permitted':'prohibited',scopes:['project'],clients:['claude-code'],change:{identity:changeIdentity},inputs:{text:{allowDeclared:true}},lifecycle:{replace:true,adopt:false,remove:true}})].filter(Boolean),
    ...(!previous?{sources:{published:[{repository:catalog.data.repository,commit:catalog.data.commit}]}}:{}) };
  const add = defaults => {const entry=edit(defaults);if(entry)policy.entries.push(entry);};
  for (const [framework,obligation] of Object.entries(body.frameworkRules || {})) add({id:'catalog-framework-'+framework,obligation,scopes:['project'],clients:['claude-code'],content:{framework}});
  for (const [item,obligation] of Object.entries(body.itemRules || {})) add({id:'workbench-item-'+item,obligation,scopes:['project'],content:{item}});
  for (const [kind,obligation] of Object.entries(body.kindRules || {})) add({id:'workbench-kind-'+kind,obligation,scopes:['project'],content:{kind}});
  const posture = body.posture || policyPosture(previous);
  if (posture === 'only-selected') {
    const allowed = body.allowedFrameworks ?? previous?.sources?.frameworks ?? Object.entries({...body.frameworkRules,superpowers:body.obligation}).filter(([,value]) => value && value !== 'prohibited').map(([id]) => id);
    policy.sources = {...policy.sources,frameworks:[...new Set(allowed)].sort()};
  } else if (Array.isArray(policy.sources?.frameworks)) {
    const {frameworks,...sources} = policy.sources;if(Object.keys(sources).length)policy.sources = sources;else delete policy.sources;
  }
  return policy;
}
export function policyChanges(before, after) {
  const changes = [];
  if (before?.id !== after.id) changes.push('Policy name: ' + (before?.id || 'none') + ' → ' + after.id);
  const previous = new Map((before?.entries || []).map(entry => [entry.id,entry]));
  for (const entry of after.entries) {
    const old = previous.get(entry.id);previous.delete(entry.id);
    if (JSON.stringify(old) !== JSON.stringify(entry)) changes.push((entry.content?.item || entry.content?.framework || entry.content?.kind || entry.id) + ': ' + (old?.obligation || 'no rule') + ' → ' + entry.obligation);
  }
  for (const entry of previous.values()) changes.push((entry.content?.item || entry.content?.framework || entry.content?.kind || entry.id) + ': ' + entry.obligation + ' → no rule');
  if (JSON.stringify(before?.sources?.frameworks) !== JSON.stringify(after.sources?.frameworks)) changes.push('Framework boundary: ' + (before?.sources?.frameworks?.join(', ') || (Array.isArray(before?.sources?.frameworks)?'none':'not limited')) + ' → ' + (after.sources?.frameworks?.join(', ') || (Array.isArray(after.sources?.frameworks)?'none':'not limited')));
  const {frameworks:oldFrameworks,...oldSources} = before?.sources || {}, {frameworks:newFrameworks,...newSources} = after.sources || {};
  if (JSON.stringify(oldSources) !== JSON.stringify(newSources)) changes.push('Other allowed sources changed; see the validated policy.');
  return changes;
}
