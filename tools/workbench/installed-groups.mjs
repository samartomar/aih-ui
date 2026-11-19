// Group only whole-plugin receipts and their notice-only bookkeeping. A Catalog
// choice remains its own unit even if it shares the plugin's framework.
export function installedGroups(inventory, requests = {}, selections = {}) {
  const entries = inventory.entries || [], used = new Set(), groups = [];
  const explicit = new Set(Object.values(selections).flatMap(selection => selection.items));
  for (const owner of entries.filter(entry => entry.localPlugin || entry.plugins?.length)) {
    const request = requests[owner.framework];
    const included = new Set((request?.plan?.plan || []).flatMap(step => [step.item,...(step.items || []),...(step.contains || [])].filter(Boolean)));
    const related = request ? entries.filter(entry => entry !== owner && entry.framework === owner.framework &&
      entry.items?.length && entry.items.every(id => included.has(id) && !explicit.has(id)) &&
      entry.members?.length && entry.members.every(member => member.kind === 'file' && member.path.replaceAll('\\','/').includes('/.aihq/notices/' + owner.framework + '/'))) : [];
    const members = [owner,...related];members.forEach(entry => used.add(entry.managementId));
    groups.push({id:owner.managementId,framework:owner.framework,label:owner.framework === 'extensions'?'AIH Extensions':owner.framework === 'superpowers'?'Superpowers':owner.managementId,managementIds:members.map(entry => entry.managementId),entries:members,wholePlugin:true});
  }
  for (const entry of entries.filter(entry => !used.has(entry.managementId))) groups.push({id:entry.managementId,framework:entry.framework,label:entry.managementId,managementIds:[entry.managementId],entries:[entry],wholePlugin:false});
  return groups;
}
