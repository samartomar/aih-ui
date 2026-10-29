// Set-owned first-run guidance: the member a Catalog set declares to run first. Exact set identity only
// (framework + setId + setSha256 against the checked release); the answer is presentation guidance, never a
// command, a fetch or an execution. Unavailable stays unavailable — nothing is inferred from a name (#166-AC04).

export function firstRunForSets(inventories, sets = []) {
  if (!Array.isArray(sets) || sets.length > 64) return { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: 'Supply at most 64 exact set references.' }] };
  const results = [];
  for (const ref of sets) {
    if (!ref || typeof ref.framework !== 'string' || typeof ref.setId !== 'string' || typeof ref.setSha256 !== 'string')
      return { status: 'refused', diagnostics: [{ code: 'INPUT_INVALID', message: 'Each set names its framework, setId and setSha256 exactly.' }] };
    // Exact identity can live in ANY checked revision of the framework (Q11): search every inventory that
    // carries the framework id, and report ambiguity instead of silently taking the first inventory.
    const candidates = (inventories ?? []).filter(entry => entry.release.framework?.id === ref.framework)
      .map(entry => ({ entry, set: entry.release.sets?.find(candidate => (candidate.id ?? candidate.setId) === ref.setId && candidate.setSha256 === ref.setSha256) }))
      .filter(match => match.set);
    if (candidates.length > 1) { results.push({ set: ref, firstRun: null, reason: 'The exact set identity appears in more than one checked revision; guidance is ambiguous.' }); continue; }
    const release = candidates[0]?.entry.release;
    // Catalog's public vocabulary: a release set is `id` + `setSha256`; Core origins call the same value setId.
    const set = candidates[0]?.set;
    if (!release || !set) { results.push({ set: ref, firstRun: null, reason: 'The exact set is unavailable in the checked sources, so first-step guidance is unavailable.' }); continue; }
    if (!set.firstRun) { results.push({ set: ref, firstRun: null, reason: 'This set declares no first step.' }); continue; }
    const item = (release.items ?? []).find(candidate => candidate.id === set.firstRun.itemId);
    if (!item || set.firstRun.framework !== ref.framework) { results.push({ set: ref, firstRun: null, reason: 'The set’s declared first step does not resolve to an item in its checked source.' }); continue; }
    results.push({ set: ref, firstRun: { itemId: item.id, name: item.label ?? item.name ?? item.id, kind: item.kind } });
  }
  return { status: 'ok', value: results };
}

/** One plain guidance line per set; unavailable reasons are said, never replaced by a guess. */
export function firstRunWords(results = []) {
  return results.map(result => result.firstRun
    ? `First step: ${result.firstRun.name} (${result.firstRun.kind}) — the step its set ${result.set.setId} declares to run first.`
    : `First-step guidance unavailable for set ${result.set.setId}: ${result.reason}`);
}
