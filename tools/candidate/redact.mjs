// Redaction for the failure report: credential formats by shape, and values whose name says they are secret.
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SECRET_NAME = /token|secret|password|passwd|api[_-]?key|credential|cookie/i;
// `auth` only as a whole word of the name (auth, _auth, auth_token, authToken, authorization), never inside authority or author.
const AUTH_WORDS = new Set(['auth', 'authorization']);
const sensitive = name => SECRET_NAME.test(name)
  || name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).some(word => AUTH_WORDS.has(word));

export function redact(text, { realHome } = {}) {
  let result = String(text);
  if (realHome) {
    const pattern = realHome.split(/[\\/]/).map(escape).join('[\\\\/]');
    result = result.replace(new RegExp(pattern, process.platform === 'win32' ? 'gi' : 'g'), '<real-home>');
  }
  return result
    .replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g, '[redacted]')
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bnpm_[A-Za-z0-9]{20,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/<>"@]+@/gi, '$1[redacted]@')
    .replace(/(\bAuthorization\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(\bBearer\s+)[^\s,"';]+/gi, '$1[redacted]')
    .replace(/("((?:\\.|[^"\\])+)"\s*:\s*)"(?:\\.|[^"\\])*"/g, (all, prefix, name) => sensitive(name) ? `${prefix}"[redacted]"` : all)
    // `name = value` and `name: value` outside JSON (a URL's `://` is not a pair).
    .replace(/(\b[\w.-]+[ \t]*=[ \t]*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s;&]+)/g, (all, prefix) => sensitive(prefix.split('=')[0]) ? `${prefix}[redacted]` : all)
    .replace(/(\b[\w.-]+[ \t]*:[ \t]*)(?!\/\/)([^\r\n]+)/g, (all, prefix, value) => sensitive(prefix.split(':')[0]) && value !== '[redacted]' ? `${prefix}[redacted]` : all);
}

export function redactJson(value, opts) {
  if (typeof value === 'string') return redact(value, opts);
  if (Array.isArray(value)) return value.map(item => redactJson(item, opts));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, opts), sensitive(key) ? '[redacted]' : redactJson(item, opts)]));
  return value;
}
