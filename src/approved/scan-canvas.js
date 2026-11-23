const palette = {
  background: '#0c1927', grid: '#25394a', rail: '#3d5667', dim: '#92a8b4',
  text: '#e6f2f4', mint: '#64f1d0', high: '#ff856c', medium: '#f5c176', low: '#92c9ea',
};
const duration = 2800;
const mono = 'Plex, "IBM Plex Mono", Consolas, monospace';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const strength = { critical: 3, high: 3, medium: 2, moderate: 2, low: 1 };
const subscriptions = new WeakMap();

function collect(findings) {
  const files = new Map();
  const entries = [];
  let maxLine = 0;
  let unknown = false;
  for (const [index, finding] of findings.entries()) {
    const file = typeof finding?.file === 'string' && finding.file ? finding.file : 'Location unavailable';
    const line = Number(finding?.line);
    const severity = String(finding?.severity).toLowerCase();
    const level = Object.hasOwn(strength, severity) ? strength[severity] : 0;
    if (!files.has(file)) files.set(file, files.size);
    const entry = {index, file, group: files.get(file), line: Number.isSafeInteger(line) && line > 0 ? line : null, level};
    entries.push(entry);
    if (entry.line === null) unknown = true;
    else maxLine = Math.max(maxLine, line);
  }
  const groups = [...files.keys()].slice(0, 3);
  if (files.size > 3) groups[2] = `+${files.size - 2} source files`;
  return {entries, groups, maxLine, unknown};
}

function tickStep(maxLine, count) {
  const rough = Math.max(1, maxLine / count);
  const base = 10 ** Math.floor(Math.log10(rough));
  const factor = [1, 2, 2.5, 5, 10].find(n => base * n >= rough && Number.isInteger(base * n));
  return base * factor;
}

function geometry(data, width, height) {
  const narrow = width < 590;
  const left = narrow ? 10 : clamp(width * 0.22, 118, 190);
  const right = width - (narrow ? 12 : 22);
  const plotEnd = data.unknown && data.maxLine ? right - 41 : right;
  const axisTop = narrow ? 22 : 25;
  const rowSize = (height - axisTop - 8) / Math.max(1, data.groups.length);
  const step = tickStep(data.maxLine, narrow ? 3 : 4);
  const end = Math.ceil(data.maxLine / step) * step;
  const lineX = line => line === null ? right - 3 : left + line / end * (plotEnd - left);
  const rails = data.groups.map((name, i) => ({
    name, y: axisTop + (i + (narrow ? 0.63 : 0.54)) * rowSize, markers: new Map(),
  }));
  const positions = [];
  const marks = [];
  for (const entry of data.entries) {
    const rail = rails[Math.min(2, entry.group)];
    const x = lineX(entry.line);
    // Several findings can occupy the same visual pixel at this zoom.
    const bin = Math.round(x / 3);
    let mark = rail.markers.get(bin);
    if (!mark) {
      mark = {x, y: rail.y, level: entry.level, entry, indices: [], fraction: (x-left) / Math.max(1, right-left)};
      rail.markers.set(bin, mark);
      marks.push(mark);
    }
    mark.indices.push(entry.index);
    if (entry.level > mark.level) { mark.level = entry.level; mark.entry = entry; }
    positions[entry.index] = mark;
  }
  for (const rail of rails) rail.markers = [...rail.markers.values()].sort((a, b) => a.x - b.x);
  return {width, height, narrow, left, right, plotEnd, axisTop, rowSize, step, end, rails, marks, positions};
}

export function mount(canvas, {onPick, onFrame} = {}) {
  subscriptions.get(canvas)?.destroy();
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let data = collect([]);
  let chart;
  let current = -1;
  let hovered = null;
  let probe = null;
  let fraction = 1;
  let reported = -1;
  let frame = 0;
  let start = 0;
  let visible = false;
  let skipped = false;
  let listening = false;
  let disposed = false;
  let ratio = 0;

  function segment(x1, y1, x2, y2, color, weight = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = weight;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function circle(x, y, radius, color, fill = true) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = color; ctx.fill(); }
    else { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function fitLabel(value, room) {
    if (ctx.measureText(value).width <= room) return value;
    let cut = Math.min(value.length - 1, Math.ceil(room / 5));
    while (cut > 0 && ctx.measureText('…' + value.slice(-cut)).width > room) cut--;
    return cut ? '…' + value.slice(-cut) : '';
  }

  function axis() {
    const {width, height, left, right, plotEnd, end, step, narrow, axisTop} = chart;
    const top = axisTop - 4;
    ctx.font = `11px ${mono}`;
    ctx.fillStyle = palette.dim;
    ctx.textAlign = 'left';
    if (!narrow) ctx.fillText('SOURCE LINE', 12, top - 5);
    segment(left, top, right, top, palette.grid);
    if (end) {
      const tickCount = end / step;
      for (let i = 0; i <= tickCount * 4; i++) {
        const x = left + (plotEnd-left) * i / (tickCount * 4);
        const major = i % 4 === 0;
        segment(x, top, x, top + (major ? 5 : 2), palette.rail);
        if (!major) continue;
        segment(x, top + 7, x, height - 7, palette.grid);
        ctx.fillStyle = palette.dim;
        ctx.textAlign = i === 0 ? 'left' : i === tickCount * 4 ? 'right' : 'center';
        ctx.fillText(String(i * step / 4), x, top - 5);
      }
    }
    if (data.unknown) {
      ctx.textAlign = 'right'; ctx.fillStyle = palette.dim;
      ctx.fillText('NO LINE', width - (narrow ? 6 : 12), top - 5);
    }
    ctx.textAlign = 'left';
  }

  function fileLabel(rail) {
    const {narrow, left, rowSize, width} = chart;
    const label = rail.name.replaceAll('\\', '/');
    const split = label.lastIndexOf('/');
    if (narrow) {
      ctx.font = `11px ${mono}`;
      ctx.fillStyle = palette.text;
      ctx.fillText(fitLabel(label, width - 20), 10, rail.y - rowSize * 0.33);
    } else {
      ctx.font = `13px ${mono}`;
      ctx.fillStyle = palette.text;
      ctx.fillText(fitLabel(label.slice(split + 1), left - 22), 12, rail.y + (split < 0 ? 4 : 0));
      if (split >= 0) {
        ctx.font = `10px ${mono}`; ctx.fillStyle = palette.dim;
        ctx.fillText(fitLabel(label.slice(0, split + 1), left - 22), 12, rail.y + 15);
      }
    }
  }

  function amplitude(level) {
    return Math.min(8 + level * 3.8, chart.rowSize * (chart.narrow ? 0.24 : 0.33));
  }

  function ink(level) {
    return level === 3 ? palette.high : level === 2 ? palette.medium : level === 1 ? palette.low : palette.mint;
  }

  function pulse(mark, chosen) {
    const {x, y} = mark;
    const level = chosen ? data.entries[current].level : mark.level;
    const a = amplitude(level);
    const color = ink(level);
    const swept = fraction >= mark.fraction;
    const hit = fraction === 1 ? 0 : 1 - clamp((fraction - mark.fraction) / 0.13, 0, 1);
    ctx.globalAlpha = swept || chosen ? 1 : 0.48;
    ctx.beginPath();
    ctx.moveTo(x - 8, y); ctx.lineTo(x - 4.5, y - a * 0.16);
    ctx.lineTo(x - 2.6, y + a * 0.19); ctx.lineTo(x, y - a);
    ctx.lineTo(x + 2.8, y + a * 0.42); ctx.lineTo(x + 4.8, y - a * 0.12); ctx.lineTo(x + 8, y);
    ctx.strokeStyle = color; ctx.lineWidth = chosen ? 2.1 : 1.55; ctx.stroke();
    ctx.closePath();
    ctx.save(); ctx.globalAlpha *= 0.2; ctx.fillStyle = color; ctx.fill(); ctx.restore();
    circle(x, y - a, chosen ? 3.1 : 2.25, color);
    if (chosen) circle(x, y - a, 6.2, color, false);
    if (swept && hit > 0) {
      ctx.globalAlpha = hit * 0.68;
      circle(x, y - a, 4 + (1 - hit) * 17, color, false);
    }
    ctx.globalAlpha = 1;
  }

  function markLabel(mark, chosen, previousRight) {
    const {narrow, width} = chart;
    const entry = chosen && current >= 0 && chart.positions[current] === mark ? data.entries[current] : mark.entry;
    if (entry.line === null) return previousRight;
    const value = String(entry.line);
    ctx.font = `${chosen ? '600 ' : ''}${narrow ? 10 : 11}px ${mono}`;
    const w = ctx.measureText(value).width + (chosen ? 10 : 0);
    const left = clamp(mark.x - w / 2, 3, width - w - 3);
    if (left < previousRight + 4 && !chosen) return previousRight;
    const baseline = mark.y + (narrow ? 16 : 21);
    if (chosen) {
      ctx.fillStyle = ink(entry.level);
      ctx.fillRect(left, baseline - 10, w, 14);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = chosen ? palette.background : palette.dim;
    ctx.fillText(value, left + w / 2, baseline + (chosen ? 0.5 : 0));
    ctx.textAlign = 'left';
    return left + w;
  }

  function sweep() {
    const {left, right, axisTop, height} = chart;
    const x = left + fraction * (right-left);
    const tail = Math.min(x - left, Math.max(35, (right-left) * 0.1));
    if (tail > 1) {
      const gradient = ctx.createLinearGradient(x - tail, 0, x, 0);
      gradient.addColorStop(0, 'rgba(100,241,208,0)');
      gradient.addColorStop(1, 'rgba(100,241,208,0.14)');
      ctx.fillStyle = gradient; ctx.fillRect(x - tail, axisTop - 3, tail, height - axisTop - 4);
    }
    segment(x, axisTop - 3, x, height - 7, palette.mint, 1.35);
    ctx.fillStyle = palette.mint;
    ctx.beginPath(); ctx.moveTo(x - 3, axisTop - 5); ctx.lineTo(x + 3, axisTop - 5);
    ctx.lineTo(x, axisTop + 1); ctx.closePath(); ctx.fill();
    for (const rail of chart.rails) circle(x, rail.y, 2.5, palette.mint);
  }

  function inspection() {
    const {x, mark} = probe;
    const entry = chart.positions[current] === mark ? data.entries[current] : mark.entry;
    ctx.save();
    ctx.setLineDash([2, 4]);
    segment(x, chart.axisTop + 4, x, chart.height - 7, '#83b9b3');
    segment(x, mark.y, mark.x, mark.y, palette.mint);
    ctx.restore();
    circle(mark.x, mark.y - amplitude(entry.level), 8, palette.mint, false);
    const caption = entry.line === null ? 'NO LINE' : 'L' + entry.line;
    ctx.font = `10px ${mono}`;
    const w = ctx.measureText(caption).width + 9;
    const px = clamp(x - w / 2, 0, chart.width - w);
    ctx.fillStyle = palette.mint; ctx.fillRect(px, 1, w, 14);
    ctx.fillStyle = palette.background; ctx.textAlign = 'center';
    ctx.fillText(caption, px + w / 2, 11.5); ctx.textAlign = 'left';
  }

  function paint() {
    if (!chart || !ctx) return;
    const {width, height, left, right, rails, positions} = chart;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);
    if (!rails.length) {
      ctx.font = `12px ${mono}`; ctx.fillStyle = palette.dim;
      ctx.fillText('No finding locations to plot', 12, height / 2);
      return;
    }
    axis();
    const selected = positions[current];
    for (const rail of rails) {
      const active = selected && selected.y === rail.y;
      segment(left, rail.y, right, rail.y, palette.rail);
      if (active) {
        const trace = ctx.createLinearGradient(left, 0, Math.max(left + 1, selected.x), 0);
        trace.addColorStop(0, '#327669'); trace.addColorStop(1, '#77c9b9');
        segment(left, rail.y, selected.x, rail.y, trace, 1.4);
        ctx.fillStyle = palette.mint; ctx.fillRect(left - 1.5, rail.y - 2, 3, 4);
      }
      if (fraction < 1) segment(left, rail.y, left + fraction * (right - left), rail.y, '#4d968d');
      fileLabel(rail);
      let labelEdge = -10;
      for (const mark of rail.markers) {
        if (selected === mark) continue;
        pulse(mark, false);
        if (!active || Math.abs(mark.x - selected.x) > 30) {
          labelEdge = markLabel(mark, false, labelEdge);
        }
      }
    }
    if (fraction < 1) sweep();
    if (selected) { pulse(selected, true); markLabel(selected, true, -10); }
    if (probe) inspection();
  }

  function resize() {
    if (disposed) return;
    const box = canvas.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const nextRatio = window.devicePixelRatio || 1;
    if (chart && chart.width === box.width && chart.height === box.height && ratio === nextRatio) return;
    ratio = nextRatio;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    chart = geometry(data, box.width, box.height);
    hovered = null; probe = null;
    paint();
  }

  function notify() {
    if (reported !== fraction) { reported = fraction; onFrame?.(fraction); }
  }

  function suspend() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; start = 0;
  }

  function advance(time) {
    frame = 0;
    if (!start) start = time - fraction * duration;
    fraction = clamp((time - start) / duration, 0, 1);
    paint(); notify();
    if (fraction < 1 && visible && !skipped && !document.hidden && !disposed) frame = requestAnimationFrame(advance);
  }

  function animate() {
    if (frame || disposed || !visible || skipped || document.hidden || !chart || fraction >= 1) return;
    frame = requestAnimationFrame(advance);
  }

  function stop() {
    suspend(); fraction = 1; paint(); notify();
  }

  function replay() {
    if (disposed) return;
    if (reduce.matches || !data.entries.length) { stop(); return; }
    suspend(); fraction = 0; paint(); notify(); animate();
  }

  function select(index) {
    if (disposed || !Number.isInteger(index)) return;
    current = index >= 0 && index < data.entries.length ? index : -1;
    paint();
  }

  function setData(findings) {
    if (disposed) return;
    data = collect(Array.isArray(findings) ? findings : []);
    current = data.entries.length ? 0 : -1;
    hovered = null; probe = null; chart = null;
    resize(); replay();
  }

  function hit(event) {
    if (!chart) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let close = null, best = event.pointerType === 'touch' ? 24 : 16;
    for (const mark of chart.marks) {
      const top = mark.y - amplitude(mark.level);
      const bottom = mark.y + (chart.narrow ? 16 : 21);
      const distance = Math.hypot(x - mark.x, Math.max(top - y, 0, y - bottom));
      if (distance < best) { close = mark; best = distance; }
    }
    return close;
  }

  function hover(event) {
    if (event.pointerType === 'touch' || !chart || !chart.marks.length) return;
    hovered = hit(event);
    if (reduce.matches) {
      canvas.style.cursor = hovered ? 'pointer' : '';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < chart.left - 5 || x > chart.right + 5 || y < chart.axisTop - 5) { leave(); return; }
    const rail = chart.rails.reduce((a, b) => Math.abs(y - a.y) <= Math.abs(y - b.y) ? a : b);
    const mark = hovered || rail.markers.reduce((a, b) => Math.abs(x - a.x) <= Math.abs(x - b.x) ? a : b);
    probe = {x: clamp(x, chart.left, chart.right), mark};
    canvas.style.cursor = hovered ? 'pointer' : 'crosshair';
    paint();
  }

  function leave() {
    if (!hovered && !probe && !canvas.style.cursor) return;
    hovered = null; probe = null; canvas.style.cursor = ''; paint();
  }

  function pick(event) {
    const mark = hit(event);
    if (!mark) return;
    const previous = mark.indices.indexOf(current);
    const index = mark.indices[(previous + 1) % mark.indices.length];
    select(index); onPick?.(index);
  }

  function activeListeners(active) {
    if (active === listening) return;
    listening = active;
    const method = active ? 'addEventListener' : 'removeEventListener';
    canvas[method]('pointermove', hover);
    canvas[method]('pointerleave', leave);
    canvas[method]('click', pick);
    if (!active) leave();
  }

  function activity() {
    const active = visible && !skipped && !document.hidden;
    activeListeners(active);
    if (active) { resize(); animate(); } else suspend();
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting; activity();
  });
  const observer = new ResizeObserver(resize);
  const onSkipped = event => { skipped = event.skipped; activity(); };
  const onMotion = () => { if (reduce.matches) { leave(); stop(); } };
  intersection.observe(canvas);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', activity);
  canvas.addEventListener('contentvisibilityautostatechange', onSkipped);
  window.addEventListener('resize', resize);
  reduce.addEventListener('change', onMotion);
  document.fonts?.ready.then(() => { if (!disposed && visible) paint(); });

  function destroy() {
    disposed = true; suspend(); activeListeners(false);
    intersection.disconnect(); observer.disconnect();
    canvas.removeEventListener('contentvisibilityautostatechange', onSkipped);
    document.removeEventListener('visibilitychange', activity);
    window.removeEventListener('resize', resize);
    reduce.removeEventListener('change', onMotion);
    subscriptions.delete(canvas);
  }

  const api = {setData, select, replay, stop, destroy};
  subscriptions.set(canvas, api);
  return api;
}
