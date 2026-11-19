import { renderDesignSample } from '../../src/report/render.js';

// Match the names readers see in the original console to the narrower observations in a Core capture.
const panels = [
  ['sec-hero', 'Harness wiring', 'Diagnostic status and check counts. The wiring axes and score are examples.', true],
  ['sec-ready', 'Developer readiness', 'Passed, failed, unavailable and skipped checks. The readiness score is illustrative.', true],
  ['sec-actions', 'What to fix first', 'Review items derived from checks, tool states and diagnostics. Repair commands are illustrative.', true],
  ['sec-wins', 'Remediation ledger', 'Needs a history of completed repairs and their verified outcomes.'],
  ['sec-context', 'Per-turn context', 'Needs measured context size and budget per turn.'],
  ['sec-activity', 'Activity and velocity', 'Needs repository history and recorded usage.'],
  ['sec-quality', 'Guardrails and test ratio', 'Needs enforcement checks and test measurements.'],
  ['sec-drift', 'Drift and coherence', 'Needs a comparison of managed files and client configuration.'],
  ['sec-mcp', 'MCP plumbing', 'Needs server discovery and tool execution observations.'],
  ['sec-adoption', 'Setup and tooling', 'Reported tool states, checks and observations. Usage and adoption rates require separate evidence.', true],
  ['sec-support', 'Enterprise support', 'A support draft derived from diagnostic findings.', true],
  ['sec-period', 'Trends', 'Needs comparable captures over time.'],
  ['sec-skills', 'Skill investment', 'Needs skill inventory and invocation counts.'],
  ['sec-skillgov', 'Skill governance', 'Needs skill decisions and Scan evidence linked to the reviewed revision.'],
];

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);

// This function travels with the offline HTML and operates on its rendered sections.
export function enableReportKeyboard() {
  const field = document.getElementById('palette-input');
  const list = document.getElementById('palette-list');
  const trigger = document.querySelector('[aria-label="Command palette"]');
  list.setAttribute('role','listbox');
  field.setAttribute('role','combobox');
  field.setAttribute('aria-label','Jump to a section');
  field.setAttribute('aria-controls',list.id);
  let active = 0;
  function mark(index, reveal) {
    const options = [...list.querySelectorAll('.palette-item')];
    active = Math.max(0, Math.min(index, options.length - 1));
    field.removeAttribute('aria-activedescendant');
    options.forEach((option, i) => {
      option.id = 'jump-option-' + i;
      option.setAttribute('role','option');
      option.setAttribute('aria-selected',String(i === active));
      option.classList.toggle('active', i === active);
    });
    if (options[active]) {
      field.setAttribute('aria-activedescendant',options[active].id);
      if (reveal) options[active].scrollIntoView({block:'nearest'});
    }
    return options[active];
  }
  new MutationObserver(() => mark(0, false)).observe(list,{childList:true});
  function syncExpanded() {
    const open = document.getElementById('palette').classList.contains('open');
    field.setAttribute('aria-expanded',String(open));
    trigger.setAttribute('aria-expanded',String(open));
    if (!open && document.activeElement === field) trigger.focus({preventScroll:true});
  }
  syncExpanded();
  new MutationObserver(syncExpanded).observe(document.getElementById('palette'),{attributes:true,attributeFilter:['class']});
  field.addEventListener('keydown', event => {
    if (event.key === 'Escape') { trigger.focus({preventScroll:true}); return; }
    if (!['ArrowDown','ArrowUp','Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') mark(active, false)?.click();
    else mark(active + (event.key === 'ArrowDown' ? 1 : -1), true);
  });
  list.addEventListener('click', event => {
    const option = event.target.closest('.palette-item');
    const dest = option?.getAttribute('onclick')?.match(/^jumpP\('([\w-]+)'\)$/);
    const section = dest && document.getElementById(dest[1]);
    if (section) { section.tabIndex = -1; section.focus({preventScroll:true}); }
  });
}

export function developerConsole(snapshot, diagnosticUrl) {
  const supported = panels.filter(panel => panel[3]).length;
  const rows = panels.map(([id, name, scope, available]) => {
    const status = available ? (snapshot ? 'Captured' : 'Capture needed') : 'Outside snapshot';
    const action = available && snapshot ? ` <a href="${escape(diagnosticUrl)}#${id}" aria-label="Read captured evidence for ${name}">Read evidence →</a>` : '';
    return `<tr><th scope="row"><a href="#${id}">${name}</a></th><td>${status}</td><td>${scope}${action}</td></tr>`;
  }).join('');
  const caption = snapshot
    ? `Saved ${escape(snapshot.producer.name)} capture · ${escape(snapshot.capture.observedAt)} · ${snapshot.checks.length} checks · ${snapshot.tools.length} tools`
    : 'Collect an offline Core report in Reports to see evidence for this workspace.';
  const overview = `<details class="console-map"><summary><strong>V9 showcase</strong><span>Illustrative dashboard figures and commands</span><b>Panel evidence · ${snapshot ? supported+' of '+panels.length+' linked' : 'no capture'} ▾</b></summary>
    <div class="console-coverage"><h2>Panel evidence</h2><p>${caption}</p>
    <p>The diagnostic can supply evidence for ${supported} of these ${panels.length} panels. Open a captured section to read its measured values.</p>
    <table><thead><tr><th>Console panel</th><th>Core evidence</th><th>Coverage</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  const style = `<style>
    .console-map{border:1px solid var(--border-2);border-radius:var(--rs);margin:0 0 1.1rem;background:var(--surface);color:var(--fg)}
    .console-map summary{cursor:pointer;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.65rem 1rem;background:var(--ok-soft);color:var(--ok);font-size:.8rem;border-radius:inherit}
    .console-map summary b{margin-left:auto}.console-coverage{padding:1rem}.console-coverage h2{margin:0}.console-coverage p{color:var(--muted);font-size:.85rem}
    .console-coverage table{width:100%;border-collapse:collapse;font-size:.82rem}.console-coverage th,.console-coverage td{text-align:left;vertical-align:top;border-bottom:1px solid var(--border);padding:.5rem}
    .console-coverage a{color:var(--accent)}.console-coverage td a{display:inline-block}
    @media(min-width:680px) and (max-width:1040px){
      .hero{grid-template-columns:minmax(0,1fr) minmax(0,1.85fr);gap:.75rem}
      .hero-radar{padding:.75rem}.hero-narrative{padding:1rem;gap:.8rem}
      .hero-headline{font-size:clamp(1.55rem,3vw,2rem)}.hero-score-big{font-size:3rem}
    }
    @media(max-width:560px){.console-map summary b{margin-left:0}.console-coverage{padding:.6rem}.console-coverage th,.console-coverage td{padding:.35rem;overflow-wrap:anywhere}}
    </style>`;
  let html = renderDesignSample('V9 Developer Console')
    .replace('</head>', style + '</head>')
    .replace('saved snapshot · offline report', 'original showcase · illustrative figures')
    .replace(/<div class="demo-banner">.*?<\/div>/, () => overview);
  for (const [id, name, , available] of panels) {
    const source = snapshot && available ? ' · <a href="'+escape(diagnosticUrl)+'#'+id+'">Read this workspace’s evidence</a>' : '';
    const label = '<div class="section-example" style="grid-column:1/-1;font-size:.8rem">Example · '+escape(name)+source+'</div>';
    html = html.replace(new RegExp('(<section[^>]+id="'+id+'"[^>]*>)'), '$1'+label);
  }
  return html;
}
