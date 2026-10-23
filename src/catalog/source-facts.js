// Presentation only: Catalog owns profile interpretation and field provenance.
export function sourcePresentation(item = {}) {
  const facts = item.metadata?.sourceFacts;
  const prose = (value, fallback) => typeof value === 'string' && value.trim() ? value : fallback;
  const field = value => value && (value.state === 'authored' ? typeof value.value === 'string'
    : ['absent', 'invalid'].includes(value.state) && typeof value.required === 'boolean') && typeof value.locator === 'string';
  const usable = facts && ['valid', 'profile-error', 'malformed', 'unsupported'].includes(facts.status)
    && typeof facts.identifier === 'string' && typeof facts.profile === 'string' && field(facts.name) && field(facts.description)
    && Array.isArray(facts.diagnostics) && facts.diagnostics.every(value => value && typeof value.field === 'string' && typeof value.message === 'string')
    && (facts.redactions === undefined || Array.isArray(facts.redactions) && facts.redactions.every(value => value && typeof value.path === 'string' && typeof value.reason === 'string'));
  if (!usable) return { name: facts === undefined ? prose(item.label, item.id) : item.id,
    description: facts === undefined ? prose(item.description, 'Description not published.') : 'Source facts unavailable (invalid metadata).', facts: null };
  const description = (value, label) => value.state === 'authored' ? prose(value.value, `${label} not declared.`)
    : `${label} ${value.state === 'invalid' ? 'invalid' : 'not declared'} (${value.required ? 'required' : 'optional'}).`;
  return { name: facts.name.state === 'authored' ? prose(facts.name.value, facts.identifier) : facts.identifier,
    description: description(facts.description, 'Description'), facts };
}
