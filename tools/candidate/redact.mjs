const sensitive = /token|secret|password|passwd|api[_-]?key|auth|credential|cookie/i;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/<>"@]+@/gi, '$1[redacted]@')
    .replace(/(\bAuthorization\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(\bBearer\s+)[^\s,"';]+/gi, '$1[redacted]')
    .replace(/("((?:\\.|[^"\\])+)"\s*:\s*)"(?:\\.|[^"\\])*"/g, (all, prefix, name) => sensitive.test(name) ? `${prefix}"[redacted]"` : all)
    .replace(/(\b[\w.-]+\s*=\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s;&]+)/g, (all, prefix) => sensitive.test(prefix.split('=')[0]) ? `${prefix}[redacted]` : all);
}

export function redactJson(value, opts) {
  if (typeof value === 'string') return redact(value, opts);
  if (Array.isArray(value)) return value.map(item => redactJson(item, opts));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, opts), sensitive.test(key) ? '[redacted]' : redactJson(item, opts)]));
  return value;
}
