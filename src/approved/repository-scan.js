import {action, field, hint, input, node, section, downloadJson} from './dom.js';

export function repositoryScan(host) {
  const folder = input('', () => {});
  const output = section();
  output.setAttribute('role', 'status');
  const submit = action('Scan repository', async () => {
    submit.disabled = true;
    output.replaceChildren(hint('Scanning the selected folder…'));
    try {
      const response = await fetch('/api/repository-scan', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({folder:folder.value.trim()})});
      const report = await response.json();
      if (!response.ok || !Array.isArray(report.results)) throw Error(report.reason || 'The scanner could not read this folder.');
      output.replaceChildren(node('h3','Scan results'), hint(report.results.length + ' items reported' + (report.reason ? ' · ' + report.reason : '')));
      for (const item of report.results) {
        const details = node('details');
        details.append(node('summary',item.name + ' · ' + (item.label ?? item.status)));
        if (item.coverage || item.reason) details.append(hint(item.reason || item.coverage + ' coverage'));
        for (const f of item.findings ?? []) details.append(hint([f.severity,f.rule,f.path,f.line,f.text].filter(Boolean).join(' · ')));
        output.append(details);
      }
      output.append(action('Export scan results',()=>downloadJson('repository-scan.json',report)));
    } catch(error) {output.replaceChildren(hint(error.message));}
    finally {submit.disabled = false;}
  },true);
  host.append(section('Scan your repository', field('Local repository folder',folder),submit,output));
}
