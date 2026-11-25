// Several Scan revisions of one exact item, read through public @aihq/scan/read only.
// An index entry is either one record ({ revision, summary, bundle, sarif }) or
// { revisions: [record, ...], withdrawals?: [{ withdrawal, bundle }] }.
const invalid = message => Object.assign(Error(message), { code: 'CATALOG_INPUT_INVALID', status: 400 });
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

export function indexedRevisions(entry) {
  if (!isRecord(entry)) throw invalid('Invalid Scan index entry');
  const listed = 'revisions' in entry ? entry.revisions : [entry];
  const withdrawals = entry.withdrawals ?? [];
  if (!Array.isArray(listed) || !listed.length || !Array.isArray(withdrawals)) throw invalid('Invalid Scan index entry');
  const seen = new Set();
  for (const record of listed) {
    if (!isRecord(record) || !Number.isSafeInteger(record.revision) || record.revision < 1 || !Array.isArray(record.sarif)) throw invalid('Invalid Scan revision in the index');
    if (seen.has(record.revision)) throw invalid('Duplicate Scan revision in the index');
    seen.add(record.revision);
  }
  for (const withdrawal of withdrawals) if (!isRecord(withdrawal) || !withdrawal.withdrawal || !withdrawal.bundle) throw invalid('Invalid Scan withdrawal in the index');
  return { revisions: [...listed].sort((a, b) => a.revision - b.revision), withdrawals };
}

// Every asset an entry names, so the host can register them before any read.
export function indexedAssets(entry) {
  const { revisions, withdrawals } = indexedRevisions(entry);
  return [...revisions.flatMap(record => [record.summary, record.bundle, ...record.sarif]),
    ...withdrawals.flatMap(withdrawal => [withdrawal.withdrawal, withdrawal.bundle])];
}

export function verificationLabel(verification) {
  if (verification.status !== 'ok') return 'Signature not verified · ' + (verification.reason || verification.status);
  if (verification.withdrawn) return 'Signature verified · withdrawn by its publisher';
  return verification.signer?.trusted ? 'Signature verified · default trusted publisher' : 'Signature verified · publisher not trusted';
}

const matchLabels = { matched: 'content matches the pinned Catalog files', differs: 'content differs from the pinned Catalog files',
  'not-checked': 'content not matched locally', refused: 'content match refused' };
export const matchLabel = match => matchLabels[match.status];

// What produced a revision, as the summary records it.
function producer(summary) {
  return (summary.tools || []).map(tool => {
    const ai = tool.mode === 'ai' && isRecord(tool.ai) ? tool.ai : null;
    const fact = { tool: tool.tool, version: tool.version, mode: tool.mode,
      ...(ai?.model && { model: ai.model }),
      ...(ai?.client && { client: { name: ai.client.name, version: ai.client.version } }),
      ...(ai?.effort && { effort: ai.effort }) };
    const parts = [tool.tool + ' ' + tool.version, tool.mode === 'ai' ? 'AI' : tool.mode === 'static' ? 'Static' : 'Mode not recorded'];
    if (fact.model) parts.push(fact.model);
    if (fact.client) parts.push(fact.client.name + ' ' + fact.client.version);
    if (fact.effort) parts.push('effort ' + fact.effort);
    return { ...fact, label: parts.join(' · ') };
  });
}

// Scan names files relative to the item; Catalog names them by source path.
function matchFiles(summary, files) {
  return files.map(file => {
    const paired = (summary.files || []).filter(entry => entry.sha256 === file.sha256 &&
      (file.sourcePath === entry.path || file.sourcePath.endsWith('/' + entry.path)));
    return { path: paired.length === 1 ? paired[0].path : file.sourcePath, mode: file.executable ? '100755' : '100644', bytes: file.bytes };
  });
}

async function match(scan, verification, files) {
  if (verification.status !== 'ok' || !files) return { status: 'not-checked' };
  const result = await scan.matchScan(verification, matchFiles(verification.summary, files));
  if (result.status !== 'ok') return { status: 'refused', reason: result.reason || result.status };
  return result.matches ? { status: 'matched' } : { status: 'differs', differences: result.differences };
}

// files: the item's pinned Catalog files with their bytes, or null when the host has none.
export async function readRevisions({ scan, scanKey, entry, readAsset, assetPath, files }) {
  const { revisions: records, withdrawals } = indexedRevisions(entry);
  let options;
  if (withdrawals.length) {
    options = { withdrawn: [], withdrawnBundle: [] };
    for (const withdrawal of withdrawals) {
      options.withdrawn.push(await readAsset(assetPath(withdrawal.withdrawal)));
      options.withdrawnBundle.push(await readAsset(assetPath(withdrawal.bundle)));
    }
  }
  const revisions = [];
  for (const record of records) {
    const summaryUrl = assetPath(record.summary), bundleUrl = assetPath(record.bundle);
    const bytes = await readAsset(summaryUrl), bundle = await readAsset(bundleUrl);
    const read = scan.readSummary(bytes);
    if (read.status !== 'ok' || read.summary.scanKey !== scanKey || read.summary.revision !== record.revision) throw invalid('Scan summary does not match selected item and revision');
    const verification = options ? await scan.verifySummary(bytes, bundle, undefined, options) : await scan.verifySummary(bytes, bundle);
    const trusted = verification.status === 'ok' && verification.signer?.trusted === true && !verification.withdrawn;
    const matched = await match(scan, verification, files);
    const tools = producer(read.summary);
    revisions.push({ revision: record.revision, record, summary: read.summary, summaryUrl, bundleUrl, verification,
      verificationLabel: verificationLabel(verification), trusted, withdrawn: verification.withdrawn === true,
      match: matched, matchLabel: matchLabel(matched), eligible: trusted && matched.status === 'matched',
      mode: tools.some(tool => tool.mode === 'ai') ? 'ai' : 'static', producer: tools, scannedAt: read.summary.scannedAt });
  }
  const newest = list => list.length ? list.at(-1).revision : null;
  const defaultRevision = newest(revisions.filter(revision => revision.eligible));
  // Shown when nothing qualifies as the default: trusted but not matched here, else the newest recorded.
  const fallbackRevision = defaultRevision ?? newest(revisions.filter(revision => revision.trusted && revision.match.status === 'not-checked')) ?? newest(revisions);
  return { revisions, defaultRevision, fallbackRevision };
}
