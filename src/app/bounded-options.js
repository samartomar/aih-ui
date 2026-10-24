export const OPTION_LIMIT = 40;
export function matchingOptions(entries, query, label = entry => entry.label ?? entry.id) {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = entries.filter(entry => `${label(entry)} ${entry.id ?? ''}`.toLocaleLowerCase().includes(normalized));
  return { total: matches.length, entries: matches.slice(0, OPTION_LIMIT) };
}

// A bounded native select retains ordinary keyboard navigation and accessibility.
export function fillBoundedOptions({ select, entries, query = '', value, label, key, message, placeholder = 'Choose an item' }) {
  const current = value ?? select.value, result = matchingOptions(entries, query, label);
  const shown = result.entries.slice(), selected = entries.find(entry => key(entry) === current);
  // Keep an explicit selection visible while refining the search.
  if (selected && !shown.includes(selected)) shown.push(selected);
  select.replaceChildren(new Option(result.total ? placeholder : 'No matches — change your search', ''));
  for (const entry of shown) select.append(new Option(label(entry), key(entry)));
  select.value = selected ? current : '';
  message.textContent = result.total > OPTION_LIMIT ? `Showing the first ${OPTION_LIMIT} of ${result.total} matches. Search to narrow the list.` : `${result.total} matching ${result.total === 1 ? 'item' : 'items'}.`;
  return result;
}
