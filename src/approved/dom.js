export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

export const hint = text => node('p', text, 'ix-hint');

export function action(label, run, primary = false) {
  const button = node('button', label, primary ? 'ix-primary' : 'ix-secondary');
  button.type = 'button';
  button.addEventListener('click', run);
  return button;
}

export function link(label, target, className = 'ix-secondary') {
  const a = node('a', label, className);
  a.href = target;
  return a;
}

export function section(title, ...children) {
  const block = node('section', null, 'ix-section ix-stack');
  if (title) block.append(node('h3', title));
  block.append(...children);
  return block;
}

export function field(label, control) {
  const element = node('label', null, 'ix-field');
  element.append(node('span', label), control);
  return element;
}

export function input(value, onInput, multiline = false) {
  const element = node(multiline ? 'textarea' : 'input');
  if (multiline) element.rows = 4;
  element.value = value ?? '';
  element.addEventListener('input', () => onInput(element.value));
  return element;
}

export function checkbox(label, checked, change) {
  const control = node('input');
  control.type = 'checkbox';
  control.checked = checked;
  control.addEventListener('change', () => change(control.checked));
  const element = node('label', null, 'ix-check');
  element.append(control, node('span', label));
  return element;
}

export function fileField(label, accept, change, fail) {
  const control = node('input');
  control.type = 'file';
  control.accept = accept;
  control.addEventListener('change', async () => {
    const file = control.files[0];
    control.value = '';
    if (!file) return;
    try {
      await change(file);
    } catch (error) {
      fail(error.message || 'The selected file could not be read.');
    }
  });
  return field(label, control);
}

export function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function download(filename, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = link(filename, url);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadJson(filename, data) {
  download(filename, JSON.stringify(data, null, 2) + '\n');
}

export function facts(rows) {
  const list = node('dl', null, 'ix-summary');
  for (const [label, value] of rows) {
    if (value == null) continue;
    const row = node('div');
    row.append(node('dt', label), node('dd', value));
    list.append(row);
  }
  return list;
}
