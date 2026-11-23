export async function assessmentRows(items, readSummary) {
  const byKey = new Map();
  const keys = [...new Set(items.map(item => item.scanKey))];

  async function read(key) {
    try {
      const result = await readSummary(key);
      if (result.status !== 'read') return { status: result.status };
      const { label, coverage, scannedAt } = result.summary;
      return { status: 'read', label, coverage, scannedAt };
    } catch {
      return { status: 'failed' };
    }
  }

  for (let offset = 0; offset < keys.length; offset += 8) {
    const batch = keys.slice(offset, offset + 8);
    const rows = await Promise.all(batch.map(read));
    batch.forEach((key, index) => byKey.set(key, rows[index]));
  }
  return items.map(({ id, scanKey }) => ({ id, ...byKey.get(scanKey) }));
}
