import { createHash } from 'node:crypto';
import { readFindings, readSummary } from '@aihq/scan/read';

const summaryFormat = 'aih-scan-summary/1';
const archiveFormat = 'aih-workbench-local-scan/1';
const cleanText = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value);
const itemPath = value => cleanText(value) && (value === '.' ||
  !/[\\:]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'));

function documents(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose a Scan summary or Workbench archive.');
  let primary;
  const sidecars = [];
  for (const text of files) {
    if (typeof text !== 'string') throw new Error('Choose UTF-8 JSON files.');
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (value?.version === '2.1.0' && Array.isArray(value.runs)) sidecars.push(text);
    else if (!primary && (value?.format === summaryFormat || value?.format === archiveFormat)) primary = { value, text };
    else throw new Error('Choose one Scan summary with its SARIF files, or one Workbench archive.');
  }
  if (!primary) throw new Error('A SARIF file needs its original Scan summary.');
  if (primary.value.format === summaryFormat) return { entries: [{ item: '.', summaryText: primary.text, sarifTexts: sidecars }] };
  if (sidecars.length) throw new Error('Choose the Workbench archive by itself.');
  return primary.value;
}

async function readEntry(entry) {
  if (!entry || !itemPath(entry.item) || typeof entry.summaryText !== 'string' || !Array.isArray(entry.sarifTexts)) {
    throw new Error('The archive contains an invalid Scan entry.');
  }
  const checked = readSummary(Buffer.from(entry.summaryText));
  if (checked.status !== 'ok') throw new Error('Scan refused a saved summary.');
  const { summary } = checked;
  const remaining = new Set(summary.sarif.map(record => record.sha256));
  const findings = [];
  for (const text of entry.sarifTexts) {
    if (typeof text !== 'string') throw new Error('A SARIF entry must contain its original text.');
    const bytes = Buffer.from(text);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!remaining.delete(digest)) throw new Error('A SARIF file does not match the summary or repeats another file.');
    const result = await readFindings(summary, bytes, summary.scanKey);
    if (result.status !== 'ok') throw new Error('Scan declined a saved SARIF file.');
    for (const finding of result.findings) {
      const path = entry.item === '.' ? finding.path : entry.item + '/' + finding.path;
      findings.push({ rule: finding.ruleId, severity: finding.severity, text: finding.text, path, line: finding.line });
    }
  }
  return { name: entry.item === '.' ? summary.scanKey : entry.item, status: 'assessed', label: summary.label,
    coverage: summary.coverage, findings,
    ...(remaining.size ? { reason: `${remaining.size} referenced SARIF file(s) missing.` } : {}) };
}

export async function importRepositoryScan({ files }) {
  try {
    const archive = documents(files);
    const unscanned = archive.unscanned ?? [];
    if (!Array.isArray(archive.entries) || !archive.entries.length || !Array.isArray(unscanned) ||
      unscanned.some(entry => !entry || !itemPath(entry.item) || !cleanText(entry.reason))) {
      throw new Error('The archive does not contain valid Scan entries.');
    }
    const results = [];
    for (const entry of archive.entries) results.push(await readEntry(entry));
    for (const { item, reason } of unscanned) results.push({ name: item, status: 'unavailable', reason });
    return { status: 'read', authentication: 'not-verified', results };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof SyntaxError ? 'A selected report is not valid JSON.' : error.message };
  }
}
