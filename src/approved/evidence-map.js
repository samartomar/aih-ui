import { action, facts, field, hint, node } from './dom.js';
import { mount } from './scan-canvas.js';

export function renderEvidenceMap(input, signal) {
  const findings = input.map(finding => ({
    rule: finding.ruleId ?? finding.rule ?? finding.title,
    severity: finding.severity?.level ?? finding.severity,
    message: finding.message ?? finding.text,
    file: finding.path ?? finding.file,
    line: finding.line ?? finding.startLine,
  }));
  const stage = node('section', null, 'ix-evidence-stage');
  stage.setAttribute('aria-label', 'Recorded finding locations');
  const intro = node('div', null, 'ix-stage-intro');
  const detail = node('div', null, 'ix-stack');
  detail.setAttribute('aria-live', 'polite');
  intro.append(node('h4', 'Finding locations'), hint('Replay recorded locations or select a finding to inspect it.'), detail);
  const instrument = node('div', null, 'ix-stage-instrument');
  const canvas = node('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const controls = node('div', null, 'ix-stage-controls');
  const inputRange = node('input');
  inputRange.type = 'range';
  inputRange.min = '1';
  inputRange.max = String(findings.length);
  inputRange.value = '1';
  inputRange.disabled = findings.length < 2;
  const index = node('span');
  let plotting = false;
  const replay = action('Replay findings', () => {
    if (plotting) plot.stop();
    else plot.replay();
  });
  replay.disabled = matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.append(replay, field('Finding', inputRange), index);
  instrument.append(canvas, controls);
  stage.append(intro, instrument);

  const plot = mount(canvas, {
    onPick: select,
    onFrame(fraction) {
      plotting = fraction < 1;
      replay.textContent = plotting ? 'Pause replay' : 'Replay findings';
    },
  });

  function select(position) {
    const finding = findings[position];
    if (!finding) return;
    inputRange.value = String(position + 1);
    index.textContent = (position + 1) + ' / ' + findings.length;
    detail.replaceChildren(facts([
      ['Severity', finding.severity],
      ['Rule', finding.rule],
      ['File', finding.file],
      ['Line', finding.line],
    ]));
    if (finding.message) detail.append(hint(finding.message));
    plot.select(position);
  }

  inputRange.addEventListener('input', () => {
    plot.stop();
    select(Number(inputRange.value) - 1);
  });
  signal?.addEventListener('abort', () => plot.destroy(), { once: true });
  plot.setData(findings);
  select(0);
  return stage;
}
