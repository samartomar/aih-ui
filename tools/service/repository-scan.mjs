import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

function inside(root, file) {
  const name = relative(root, file);
  return !isAbsolute(name) && name !== '..' && !name.startsWith('..' + sep);
}

export async function repositoryScan({ folder }) {
  const [{ scan }, { readSummary, readFindings }] = await Promise.all([import('@aihq/scan/host'), import('@aihq/scan/read')]);
  if (typeof folder !== 'string' || !isAbsolute(folder) || /[\x00-\x1f]/.test(folder)) throw Error('Choose an absolute project folder.');
  const root = await realpath(folder);
  const parent = await realpath(tmpdir());
  if (!(await stat(root)).isDirectory() || inside(root, parent)) throw Error('Choose a project folder outside the temporary output directory tree.');
  const temp = await mkdtemp(join(parent, 'aih-ui-scan-'));
  const outDir = join(temp, 'report');
  try {
    const run = await scan({format:'aih-scan-request/1', mode:'static', origin:'local',
      source:{format:'aih-scan-source/1', type:'folder', path:root}}, {outDir});
    const results = [];
    async function readOutput(path) {
      const file = await realpath(path);
      if (!inside(outDir, file)) throw Error('Scan returned an unexpected output file.');
      return readFile(file);
    }
    for (const item of run.results ?? []) {
      const name = item.source?.item ?? '.';
      if (item.status !== 'ok') {
        results.push({name, status:item.status, reason:item.detail || item.reason});
        continue;
      }
      const checked = readSummary(await readOutput(item.summaryPath));
      if (checked.status !== 'ok') throw Error('Scan returned an unreadable summary.');
      const findings = [];
      for (const path of item.sarifPaths) {
        const result = await readFindings(checked.summary, await readOutput(path), checked.summary.scanKey);
        if (result.status !== 'ok') throw Error('Scan refused the associated findings.');
        for (const f of result.findings) findings.push({rule:f.ruleId, severity:f.severity, text:f.text, path:f.path, line:f.line});
      }
      results.push({name, status:'assessed', label:checked.summary.label, coverage:checked.summary.coverage, findings});
    }
    return {status:run.status, reason:run.detail || run.reason, results};
  } finally {
    await rm(temp, {recursive:true, force:true});
  }
}
