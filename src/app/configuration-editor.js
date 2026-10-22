import { el } from './dom.js';

const jsonType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const knownTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
// Current JSON shapes and public Catalog input types are the only field authority.
export function configurationFields(configuration = {}, inputs = {}) {
  return [...new Set([...Object.keys(inputs), ...Object.keys(configuration)])].map(name => {
    const spec = inputs[name] ?? {}, present = Object.hasOwn(configuration, name);
    const value = present ? configuration[name] : spec.default;
    const type = value !== undefined ? jsonType(value) : spec.type;
    return { name, spec, value, type: knownTypes.includes(type) ? type : undefined, present };
  });
}

function valueEditor(value, type, name, depth = 0) {
  const node = el('fieldset', 'space-y-2 border border-wb-border rounded p-2');
  node.append(el('legend', 'font-medium', name));
  if (depth > 16 || !knownTypes.includes(type) || ((type === 'object' || type === 'array') && value === undefined)) {
    node.append(el('p', 'text-on-surface-variant', 'Structured editing unavailable: no editable shape is supplied for this input. Catalog validation is still required.'));
    return { node, supported: false };
  }
  if (type === 'object' || type === 'array') {
    const children = Object.entries(value).map(([key, child]) => ({ key, editor: valueEditor(child, jsonType(child), `${name}.${key}`, depth + 1) }));
    for (const child of children) node.append(child.editor.node);
    if (!children.length) node.append(el('p', 'text-on-surface-variant', type === 'array' ? 'Empty list. No element shape is supplied for adding entries.' : 'Empty object. No field names are supplied for adding entries.'));
    return { node, supported: children.every(child => child.editor.supported), read: () => type === 'array' ? children.map(child => child.editor.read()) : Object.fromEntries(children.map(child => [child.key, child.editor.read()])) };
  }
  if (type === 'null') { node.append(el('p', '', 'Null value (kept exactly)')); return { node, supported: true, read: () => null }; }
  const control = el('input', 'w-full bg-wb-input border border-wb-border rounded p-2');
  control.type = type === 'boolean' ? 'checkbox' : ['number', 'integer'].includes(type) ? 'number' : 'text';
  if (control.type === 'number') control.step = type === 'integer' ? '1' : 'any';
  if (type === 'boolean') control.checked = value ?? false; else control.value = value === undefined ? '' : String(value);
  control.setAttribute('aria-label', name); control.addEventListener('input', () => control.setCustomValidity(''));
  node.append(control);
  return { node, supported: true, read: () => {
    if (type === 'boolean') return control.checked;
    if (control.type !== 'number') return control.value;
    const number = Number(control.value);
    if (!control.value.trim() || !Number.isFinite(number) || (type === 'integer' && !Number.isInteger(number))) {
      control.setCustomValidity(type === 'integer' ? 'Enter a whole number.' : 'Enter a finite number.'); control.reportValidity(); control.focus(); throw new Error('invalid-field');
    }
    control.setCustomValidity(''); return number;
  } };
}

// `summary`, `submitLabel`, `open` and `intro` let another place reuse the same editor in its own words (the Hooks section, #135).
export function createConfigurationEditor({ configuration = {}, inputs = {}, label, button, review, summary = `Configure ${label}`, submitLabel = 'Review configuration', open = false,
  intro = 'Edit declared inputs and existing values. Catalog validates the proposal before acceptance. Required fields must be set; optional inputs may keep their declared defaults.' }) {
  const node = el('details', 'space-y-2'); if (open) node.open = true;
  node.append(el('summary', 'cursor-pointer text-outline', summary));
  if (intro) node.append(el('p', 'text-on-surface-variant', intro));
  const values = [];
  for (const field of configurationFields(configuration, inputs)) {
    const wrapper = el('div', 'space-y-1'), include = el('input'); include.type = 'checkbox'; include.checked = field.present || field.spec.required === true; include.disabled = field.spec.required === true;
    const caption = `${field.name}${field.spec.required ? ' (required)' : ' (optional)'} for ${label}`;
    include.setAttribute('aria-label', `Set ${field.name} explicitly`);
    const enabled = el('label', 'flex gap-2 items-center'); enabled.append(include, el('span', '', caption));
    const editor = valueEditor(field.value, field.type, `${field.name} for ${label}`); editor.node.disabled = !include.checked;
    include.addEventListener('change', () => { editor.node.disabled = !include.checked; sync(); });
    wrapper.append(enabled, editor.node);
    if (field.spec.description) wrapper.append(el('p', 'text-on-surface-variant', field.spec.description));
    if (field.spec.default !== undefined) wrapper.append(el('p', 'text-on-surface-variant', `Declared default: ${JSON.stringify(field.spec.default)}`));
    node.append(wrapper); values.push({ field, include, editor });
  }
  const blocked = el('p', 'text-on-surface-variant'); blocked.setAttribute('role', 'status');
  const submit = button(submitLabel, async () => {
    if (submit.disabled) return;
    const next = {};
    try { for (const { field, include, editor } of values) if (include.checked) Object.defineProperty(next, field.name, { value: editor.read(), enumerable: true }); }
    catch { return; }
    await review(next);
  });
  const sync = () => {
    const unsupported = values.filter(value => value.include.checked && !value.editor.supported);
    submit.disabled = unsupported.length > 0;
    blocked.textContent = unsupported.length ? `Structured review blocked for: ${unsupported.map(value => value.field.name).join(', ')}. This build needs a supplied value or supported input shape; advanced JSON is available for an exact proposal.` : '';
  };
  sync(); node.append(blocked, submit);
  const advanced = el('details', 'space-y-2'), raw = el('textarea', 'w-full bg-wb-input border border-wb-border rounded p-2 font-mono');
  raw.rows = 4; raw.value = JSON.stringify(configuration, null, 2); raw.setAttribute('aria-label', `Advanced JSON configuration for ${label}`);
  advanced.append(el('summary', 'cursor-pointer text-outline', 'Advanced configuration (JSON)'), raw, button('Review JSON configuration', async () => {
    try { const value = JSON.parse(raw.value); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Enter a JSON object.'); raw.setCustomValidity(''); await review(value); }
    catch (error) { raw.setCustomValidity(error.message); raw.reportValidity(); }
  }));
  node.append(advanced); return node;
}
