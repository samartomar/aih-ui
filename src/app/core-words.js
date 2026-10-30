// Core's own text reaches the page only when it is a plain sentence. Anything that carries a code
// (AUTHORITY_UNAVAILABLE, tool-not-observed), a function name (readGitHubPolicy()) or a file path never does.
const CODE = [
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // UPPER_SNAKE: Core codes and host variables
  /\b[a-z0-9]+(?:-[a-z0-9]+)+\b/i, // hyphen codes: x-y or longer
  /\b\w+\(\)/, // function names
  /(?:^|[\s("'])(?:~|\.{1,2})?\/[^\s]|[A-Za-z]:\\|\b[\w.-]+\/[\w.-]+/, // file paths
];
export const coreSentence = value => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Z]\S*\s.*[.!?]$/s.test(text) && !CODE.some(pattern => pattern.test(text)) ? text : undefined;
};
