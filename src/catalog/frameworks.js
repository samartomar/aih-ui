import { el } from '../app/dom.js';
import { attachTooltip } from '../app/tooltip.js';
import { iconSpan } from '../app/icons.js';
import { sourceFilterValue } from './selectors.js';
import { indexStatuses, onlyIndexStatuses } from './index-status.js';
// Names, availability and observations are public reader results projected by the host.
export function createFrameworkNavigation({ container, onChoose, onFirstStep }) {
  // tools: every chosen tool (Your tools in the header); observations are read for the ones Core has observed.
  let catalog, tools = [], selected, failure;
  function render() {
    const focused = container.contains(document.activeElement) ? document.activeElement.dataset.framework : undefined;
    container.replaceChildren();
    if (failure) { const message = el('p', '', 'Content families unavailable. See the source error.'); attachTooltip(message, failure); container.append(message); return; }
    if (!catalog) { container.append(el('p', '', 'Loading frameworks and observed counts…')); return; }
    if (catalog.frameworkFixture) container.append(el('p', 'framework-source-note', `Test fixture sources — not production data. ${catalog.frameworkFixtureLabel ?? ''}`));
    // Index status in the contract's words, from what Catalog reported; Catalog's own message is the tooltip.
    for (const status of indexStatuses(catalog)) {
      const line = el('p', 'framework-source-note', status.text); line.dataset.indexStatus = status.code;
      attachTooltip(line, status.message); container.append(line);
    }
    for (const source of catalog.frameworkSources ?? []) {
      if (source.kind === 'internal' && source.state === 'read') continue;
      // A source whose diagnostics are all index statuses is fully described by the lines above.
      if (source.kind !== 'internal' && (source.state === 'read' || onlyIndexStatuses(source))) continue;
      const disclosure = el('details', 'framework-source-note');
      const label = source.kind === 'internal' ? (source.state === 'unavailable' ? 'Internal content unavailable' : 'Internal content source failed') : source.state === 'unavailable' ? 'Release index unavailable' : 'Release index failed';
      const summary = el('summary', '', label);
      disclosure.dataset.sourceState = source.state;
      attachTooltip(summary, source.message);
      disclosure.append(summary, el('p', '', source.message)); container.append(disclosure);
    }
    const observedTools = tools.filter(value => value.observed !== false), unobserved = tools.filter(value => value.observed === false);
    const tool = observedTools[0];
    const names = list => list.map(value => value.label ?? value.id).join(', ');
    if (!tools.length) container.append(el('p', 'framework-source-note', 'Choose your tools to read observed counts.'));
    const frameworks = catalog.frameworks ?? [];
    if (!frameworks.length) container.append(el('p', '', 'No frameworks available from the configured sources. Existing content is in Filters & your sources.'));
    for (const framework of frameworks) {
      const key = `${framework.kind}:${framework.id}:${framework.sha256}`;
      const button = el('button', 'framework-choice'); button.type = 'button'; button.dataset.framework = key;
      button.setAttribute('aria-disabled', String(framework.state !== 'ready'));
      button.dataset.family = framework.name;
      button.setAttribute('aria-pressed', String(selected === key));
      const name = el('span', '', framework.name);
      const checked = observedTools.map(value => framework.observations?.find(observation => observation.tool === value.id)).filter(observation => observation?.status === 'checked');
      const count = framework.state !== 'ready' ? framework.state : !tool ? 'Choose your tools' : !checked.length ? 'Count unavailable' : `${checked.reduce((sum, observation) => sum + observation.count, 0)} observations`;
      button.append(iconSpan('kind', 'framework'), name, el('span', 'framework-count', count));
      if (framework.kind === 'fixture') button.append(el('span', 'framework-internal', 'Test content · not production'));
      if (framework.kind === 'internal') button.append(el('span', 'framework-internal', 'Internal · not verified'));
      const words = `${framework.name} ${framework.version}. ${framework.kind === 'internal' ? 'Internal content; baseline unbound, unauthenticated, non-production. ' : ''}${framework.reason ?? ''} ${tool ? `${count} in ${names(observedTools)} on this platform. Static observations, not “works”; each item still needs its own host checks.` : 'Choose your tools in the header to read observed counts. Counts are observed, not “works”.'}`;
      attachTooltip(button, words);
      button.addEventListener('click', () => {
        if (framework.state !== 'ready') return;
        selected = key;
        onChoose(framework);
        for (const row of container.querySelectorAll('[data-framework]')) row.setAttribute('aria-pressed', String(row.dataset.framework === key));
      });
      container.append(button); if (focused === key) button.focus();
    }
    // What the counts mean, as a small collapsed note below the frameworks. Its summary names every chosen tool.
    if (tools.length) {
      const note = el('details', 'framework-source-note'); note.dataset.compatibilityNote = ''; note.dataset.tools = tools.map(value => value.id).join(' ');
      // Every chosen tool by Core's label, then plainly which have none yet: Core doesn't support those yet.
      const summary = el('summary', '', `Compatibility observations for ${names(tools)}.${unobserved.length ? ` None yet for ${names(unobserved)}: not supported yet.` : ''}`);
      attachTooltip(summary, 'Harness static observations for the loaded items on this OS and architecture, not proof that an item works in this project.');
      note.append(summary, el('p', '', `Workbench host: ${catalog.hostPlatform?.os ?? "unknown OS"} ${catalog.hostPlatform?.arch ?? "unknown architecture"}`),
        el('p', '', 'Published compatibility evidence, not installed-item counts. Zero observations means not yet confirmed, not unsupported.'));
      container.append(note);
    }
  }
  const landing = document.getElementById('framework-first-step');
  landing?.addEventListener('click', () => onFirstStep());
  render();
  return { setFailure(message) { failure = message; render(); }, setCatalog(value, view) {
    catalog = value;
    const current = value?.frameworks?.find(framework => view?.family === framework.name && view?.source === sourceFilterValue('family', framework.name, framework.sha256));
    selected = current ? `${current.kind}:${current.id}:${current.sha256}` : undefined;
    render();
  }, setTool(value) { tools = Array.isArray(value) ? value : value ? [value] : []; render(); } };
}
