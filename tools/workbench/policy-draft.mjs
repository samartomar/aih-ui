// Preserve the policy's independent source and content rules. Core enforces the
// explicit framework boundary, including unknown frameworks and an empty list.
export function policyPosture(policy) {
  return Array.isArray(policy?.sources?.frameworks) || policy?.entries?.some(entry => entry.id.startsWith('workbench-only-framework-')) ? 'only-selected' : 'catalog-default';
}
export function buildPolicyDraft(previous, body, catalog, changeIdentity) {
  body = {...body,
    frameworkRules:body.frameworkRules ?? Object.fromEntries((previous?.entries || []).filter(entry => entry.id.startsWith('catalog-framework-')).map(entry => [entry.content.framework,entry.obligation])),
    itemRules:body.itemRules ?? Object.fromEntries((previous?.entries || []).filter(entry => entry.id.startsWith('workbench-item-')).map(entry => [entry.content.item,entry.obligation])),
    kindRules:body.kindRules ?? Object.fromEntries((previous?.entries || []).filter(entry => entry.id.startsWith('workbench-kind-')).map(entry => [entry.content.kind,entry.obligation]))};
  const owned = entry => ['superpowers-framework','project-instructions'].includes(entry.id) || /^(catalog-framework-|workbench-only-framework-|workbench-item-|workbench-kind-)/.test(entry.id);
  const policy = { ...(previous || {}), schema:'urn:aihq:core:organization:0.1.0', id:body.id,
    entries:[...(previous?.entries || []).filter(entry => !owned(entry)),
      {id:'superpowers-framework',obligation:body.obligation,scopes:['project'],clients:['claude-code'],content:{framework:'superpowers'}},
      {id:'project-instructions',obligation:body.allowCustom?'permitted':'prohibited',scopes:['project'],clients:['claude-code'],change:{identity:changeIdentity},inputs:{text:{allowDeclared:true}},lifecycle:{replace:true,adopt:false,remove:true}}],
    sources:previous?.sources || {published:[{repository:catalog.data.repository,commit:catalog.data.commit}]} };
  for (const [framework,obligation] of Object.entries(body.frameworkRules || {})) policy.entries.push({id:'catalog-framework-'+framework,obligation,scopes:['project'],clients:['claude-code'],content:{framework}});
  for (const [item,obligation] of Object.entries(body.itemRules || {})) policy.entries.push({id:'workbench-item-'+item,obligation,scopes:['project'],content:{item}});
  for (const [kind,obligation] of Object.entries(body.kindRules || {})) policy.entries.push({id:'workbench-kind-'+kind,obligation,scopes:['project'],content:{kind}});
  const posture = body.posture || policyPosture(previous);
  if (posture === 'only-selected') {
    const allowed = body.allowedFrameworks ?? previous?.sources?.frameworks ?? Object.entries({...body.frameworkRules,superpowers:body.obligation}).filter(([,value]) => value && value !== 'prohibited').map(([id]) => id);
    policy.sources = {...policy.sources,frameworks:[...new Set(allowed)].sort()};
  } else if (Array.isArray(policy.sources.frameworks)) {
    const {frameworks,...sources} = policy.sources;policy.sources = sources;
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
  if (JSON.stringify(before?.sources?.frameworks) !== JSON.stringify(after.sources.frameworks)) changes.push('Framework boundary: ' + (before?.sources?.frameworks?.join(', ') || (Array.isArray(before?.sources?.frameworks)?'none':'not limited')) + ' → ' + (after.sources.frameworks?.join(', ') || (Array.isArray(after.sources.frameworks)?'none':'not limited')));
  const {frameworks:oldFrameworks,...oldSources} = before?.sources || {}, {frameworks:newFrameworks,...newSources} = after.sources;
  if (JSON.stringify(oldSources) !== JSON.stringify(newSources)) changes.push('Other allowed sources changed; see the validated policy.');
  return changes;
}
