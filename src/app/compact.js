// A smaller control for the rows of Your setup's default panel (#137), so a three-item setup fits one screen.
// `extra` classes are added too. It edits the class string, so it works wherever `el` built the control.
export function compact(button, extra = '') {
  const classes = String(button.className ?? '').split(/\s+/).filter(Boolean).map(name => ({ 'px-3': 'px-2', 'py-1.5': 'py-0.5' })[name] ?? name);
  button.className = [...classes, ...extra.split(/\s+/).filter(Boolean)].join(' ');
  return button;
}
