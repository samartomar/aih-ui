// Interpret only public Core comparison facts against their retained plan steps.
// No installed settings or ownership records are read by this presentation adapter.
export function explainFileCheck(unit, request, check, inventory) {
  if (unit !== 'superpowers') return null;
  const unknown = {
    label: 'Check incomplete',
    title: 'Superpowers could not be fully checked',
    details: ['Some Superpowers files or settings could not be checked.'],
    next: 'Read the reasons below, resolve the reported issue, then check again.',
  };
  const plan = request?.plan?.plan;
  if (check?.status !== 'ok' || request?.scope !== 'project' || !request.contents?.some(content => content.framework?.id === 'superpowers') || !Array.isArray(plan) || !Array.isArray(check.targets)) return unknown;
  const seen = new Set(), rows = [];
  let incomplete = check.observation !== 'complete' || !Array.isArray(check.notChecked) || check.notChecked.length > 0;
  for (const target of check.targets) {
    if (!target?.target || !Array.isArray(target.steps) || !target.steps.length || !['match','changed','absent','unavailable'].includes(target.outcome)) { incomplete = true; continue; }
    const steps = target.steps.map(index => Number.isInteger(index) && index >= 0 ? plan[index] : null);
    if (steps.some((step,index) => !step || seen.has(target.steps[index]) || step.root !== target.target.root || (step.op === 'merge' ? step.file : step.path) !== target.target.path || !['write','merge'].includes(step.op))) { incomplete = true; continue; }
    target.steps.forEach(index => seen.add(index));
    const setting = steps.every(step => step.op === 'merge');
    const keys = new Set(steps.map(step => step.key));
    let name;
    if (setting && keys.size === 1 && keys.has('/enabledPlugins/superpowers@superpowers')) name = 'Superpowers enabled setting';
    else if (setting && keys.size === 1 && keys.has('/extraKnownMarketplaces/superpowers')) name = 'Superpowers marketplace setting';
    else if (setting) { incomplete = true; continue; }
    else name = target.target.path;
    if (target.outcome === 'unavailable' || setting && ((target.outcome === 'match' && target.reason !== 'entry-match') || (target.outcome === 'changed' && target.reason !== 'entry-changed'))) incomplete = true;
    rows.push({ name, setting, key:setting ? steps[0].key : null, enabled:setting && steps[0].key === '/enabledPlugins/superpowers@superpowers' && steps[0].entry === true, outcome:target.outcome, reason:target.reason, root:target.target.root, path:target.target.path });
  }
  if (plan.some((step,index) => !['write','merge'].includes(step?.op) || !seen.has(index))) incomplete = true;
  if (!rows.length || check.fileState === 'changed' && !rows.some(row => ['changed','absent'].includes(row.outcome))) incomplete = true;
  const changed = rows.filter(row => row.outcome === 'changed' && (!row.setting || row.reason === 'entry-changed'));
  const absent = rows.filter(row => row.outcome === 'absent');
  const unavailable = rows.filter(row => row.outcome === 'unavailable');
  const files = rows.filter(row => !row.setting);
  const details = [];
  const settings = rows.filter(row => row.setting);
  const matchingSettings = settings.filter(row => row.outcome === 'match' && row.reason === 'entry-match');
  const enabled = matchingSettings.some(row => row.enabled);
  const marketplace = matchingSettings.some(row => row.key === '/extraKnownMarketplaces/superpowers');
  const matchingFiles = !incomplete && files.length > 0 && files.every(row => row.outcome === 'match');
  if (enabled && marketplace && matchingFiles) details.push('Superpowers is enabled. Its marketplace setting and all ' + files.length + ' checked files match.');
  else {
    if (enabled) details.push('Superpowers is enabled.');
    else if (matchingSettings.some(row => row.key === '/enabledPlugins/superpowers@superpowers')) details.push('The Superpowers enabled setting matches.');
    if (marketplace) details.push('Its marketplace setting matches.');
    if (matchingFiles) details.push('All ' + files.length + ' checked Superpowers files match.');
  }
  for (const row of settings.filter(row => row.outcome !== 'match')) {
    if (row.outcome === 'absent') details.push(row.name + ' is missing from ' + row.path + '.');
    else if (row.outcome === 'unavailable' || row.reason !== 'entry-changed') details.push(row.name + ' could not be checked in ' + row.path + '.');
  }
  const fileChanges = files.filter(row => row.outcome === 'changed' || row.outcome === 'absent');
  if (changed.filter(row => row.setting).length > 1 || fileChanges.length) for (const row of changed.filter(row => row.setting)) details.push(row.name + ' changed in ' + row.path + '.');
  for (const row of fileChanges.slice(0,3)) details.push(row.path + (row.outcome === 'absent' ? ' is missing.' : ' differs from the saved plugin file.'));
  if (fileChanges.length > 3) details.push((fileChanges.length - 3) + ' more checked plugin files differ or are missing. See the exact coverage below.');
  const sharedMatch = !incomplete && settings.length === 2 && settings.every(row => row.root === 'project' && row.path === '.claude/settings.json' && row.outcome === 'match' && row.reason === 'entry-match');
  const members = inventory?.entries?.filter(entry => entry.framework === 'superpowers').flatMap(entry => entry.members || []) || [];
  for (const row of matchingSettings) {
    if (members.some(member => member.kind === 'config-entry' && member.pointer === row.key && member.path?.replaceAll('\\','/').endsWith('/' + row.path) && member.state === 'changed-by-you')) details.push((row.key === '/enabledPlugins/superpowers@superpowers' ? 'The enabled entry' : 'The marketplace entry') + '’s text changed, but its value still matches.');
  }
  if (incomplete) details.push('Some files or settings could not be checked.');
  let title, label;
  if (absent.length) { title = 'Superpowers files or settings are missing'; label = 'Missing files or settings'; }
  else if (fileChanges.length) { title = 'Superpowers plugin files changed'; label = 'Plugin files changed'; }
  else if (changed.length === 1 && changed[0].setting && changed[0].reason === 'entry-changed') { title = changed[0].name + ' changed'; label = changed[0].name.replace('Superpowers ', '') + ' changed'; }
  else if (changed.length) { title = 'Superpowers settings changed'; label = 'Settings changed'; }
  else if (incomplete || unavailable.length) { title = unknown.title; label = unknown.label; }
  else { title = 'Superpowers matches'; label = 'Matches'; }
  const changedSettings = changed.filter(row => row.setting);
  const extensionsInstalled = inventory?.entries?.some(entry => entry.framework === 'extensions' && entry.scope === 'project' && entry.installState === 'complete' && entry.plugins?.some(plugin => plugin.cli === 'claude-code' && plugin.plugin === 'aih-extensions'));
  return {
    title, label, details:details.length ? details : unknown.details,
    next: incomplete ? unknown.next : changed.length || absent.length
      ? changedSettings.length === 1 && !fileChanges.length && !absent.length
        ? 'Review the ' + (changedSettings[0].key === '/enabledPlugins/superpowers@superpowers' ? 'enabled setting' : 'marketplace setting') + ' in .claude/settings.json. Keep the change if intended.'
        : 'Review the named files and settings. Keep intended changes or review a Superpowers update.'
      : sharedMatch ? (extensionsInstalled ? 'AIH Extensions is also installed in this project. The plugins share .claude/settings.json.' : 'Other plugins can update .claude/settings.json.') + ' No action is needed for Superpowers.' : 'No action is needed for the checked files and settings.',
  };
}
