// Core's own text reaches the page only when it is a sentence; a code (tool-not-observed, AUTHORITY_UNAVAILABLE) never does.
export const coreSentence = value => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Z]\S*\s.*[.!?]$/s.test(text) ? text : undefined;
};
