import { iconFor } from '../app/icons.js';
import { browseSelections } from './catalog-choices.js';
import { evidenceDetails } from './scan.js';
import { action, checkbox, facts, field, hint, link, node, section } from './dom.js';
import { offeredToolRecipes } from './tool-setup.js';

const categoryLabels = new Map([
  ['workflow-framework', 'Workflow frameworks'],
  ['guidance', 'Guidance'],
  ['domain-skills', 'Domain skills'],
  ['ai-setup', 'AI setups'],
  ['uncategorized', 'Uncategorized'],
]);

const typeLabel = kind => kind === 'ai-setup' ? 'AI setup' : iconFor('kind', kind).label;

export function renderCatalog(host, api) {
  const data = api.data;
  const collections = new Map(data.frameworks.map(framework => [framework.id, framework]));
  const categoryOf = framework => framework?.category ?? 'uncategorized';
  const categoryLabel = category => categoryLabels.get(category) ?? category;
  const itemCategory = item => categoryOf(collections.get(item.framework));
  const toolRecipes = new Set(api.role === 'admin' ? [] : offeredToolRecipes(data, api.draft.clients));
  const itemNames = new Map();
  const itemNameKey = item => JSON.stringify([item.framework, item.kind, item.title]);
  for (const item of data.items) {
    const key = itemNameKey(item);
    itemNames.set(key, (itemNames.get(key) ?? 0) + 1);
  }
  const grid = node('div', null, 'ix-catalog-grid');
  const result = node('div', null, 'ix-catalog-list ix-stack');
  const inspector = section('Quick Look', hint('Inspect an item to see its published source, compatibility and Scan evidence.'));
  const filters = node('search', null, 'ix-catalog-filters');
  filters.setAttribute('aria-label', 'Catalog filters');
  const search = node('input');
  search.type = 'search';
  const categories = node('select');
  categories.append(new Option('All categories', ''));
  for (const [category, label] of categoryLabels) categories.append(new Option(label, category));
  const frameworks = node('select');
  frameworks.append(new Option('All frameworks', ''));
  const nameCounts = new Map();
  for (const { name } of data.frameworks) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  for (const framework of data.frameworks) {
    const name = nameCounts.get(framework.name) > 1
      ? `${framework.name} · ${categoryLabel(categoryOf(framework))} · ${framework.sha256.slice(0, 8)}` : framework.name;
    frameworks.append(new Option(name, framework.id));
  }
  const kinds = node('select');
  kinds.append(new Option('All types', ''));
  const types = [...new Set(data.items.map(item => item.kind))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
  for (const kind of types) kinds.append(new Option(typeLabel(kind), kind));
  filters.append(field('Search Catalog', search), field('Category', categories), field('Type', kinds), field('Framework', frameworks));
  const filterControls = [search, categories, kinds, frameworks];
  const resultStatus = hint('');
  resultStatus.setAttribute('role', 'status');
  const sourceStatus = hint(data.gaps.catalog);
  const clear = action('Clear filters', () => {
    for (const control of filterControls) control.value = '';
    page = 0;
    render();
    search.focus();
  });
  const filterSummary = node('div', null, 'ix-catalog-filter-summary');
  filterSummary.append(resultStatus, clear);
  const compare = node('details', null, 'ix-evidence-fold');
  const compareSummary = node('summary', 'Compare Catalog items (0)');
  const differences = checkbox('Show differences only', false, renderComparison);
  const comparison = node('div', null, 'ix-compare-grid');
  compare.append(compareSummary, differences, comparison);
  const pinned = new Map();
  let page = 0;
  let request = 0;
  const selected = new Set(api.draft.items);
  const available = new Set(data.items.map(item => item.id));
  const visibleChoices = new Map();
  let projection = browseSelections(data, selected, api.draft.catalogChoices);
  const previous = node('details', null, 'ix-evidence-fold ix-catalog-prior');
  const pageSize = 8;

  // Record the public identity of an earlier exact choice as soon as the host can still read it.
  const saved = api.draft.catalogChoices;
  if (data.hostMode === 'read-only' && (Object.keys(saved ?? {}).length !== Object.keys(projection.saved).length ||
      Object.entries(projection.saved).some(([id, fingerprint]) => saved?.[id] !== fingerprint))) {
    api.changeCatalogChoices([...selected], projection.saved);
  }

  function saveChoices() {
    const former = projection.replacements;
    projection = browseSelections(data, selected, projection.saved);
    api.changeCatalogChoices([...selected], projection.saved);
    renderPrevious();
    return former.size !== projection.replacements.size ||
      [...former].some(([id, old]) => projection.replacements.get(id) !== old);
  }

  async function inspect(item) {
    const id = ++request;
    inspector.replaceChildren(node('h3', item.title), hint('Checking this item…'));
    const { compatibility, evidence, source } = await data.inspectItem(item, {
      tool: api.draft.clients[0],
      enterprise: api.role !== 'individual',
    });
    if (id !== request || !inspector.isConnected) return;
    inspector.replaceChildren(node('h3', item.title), hint(item.description || 'No description published.'), facts([
      ['Framework', item.frameworkName],
      ['Category', categoryLabel(itemCategory(item))],
      ['Type', typeLabel(item.kind)],
      ['Catalog item', item.itemId],
      ['Compatibility', compatibility?.reason ?? (compatibility?.status ? String(compatibility.status) : 'No result for this item')],
    ]));
    inspector.append(...evidenceDetails(evidence));
    if (source?.status === 'read' && typeof source.text === 'string') {
      const details = node('details');
      details.append(node('summary', 'Published source'), node('pre', source.text));
      inspector.append(details);
    }
  }

  function renderComparison() {
    const entries = [...pinned.values()];
    compareSummary.textContent = 'Compare Catalog items (' + entries.length + ')';
    comparison.replaceChildren();
    if (!entries.length) {
      comparison.append(hint('Pin up to three items to compare.'));
      return;
    }
    const rows = [
      ['Framework', item => item.frameworkName],
      ['Category', item => categoryLabel(itemCategory(item))],
      ['Type', item => typeLabel(item.kind)],
      ['Description', item => item.description || 'Not supplied'],
      ['Published revision', item => item.root?.releaseSha256 ?? item.framework ?? 'Not supplied'],
    ];
    const visible = differences.querySelector('input').checked && entries.length > 1
      ? rows.filter(([, value]) => new Set(entries.map(value)).size > 1)
      : rows;
    for (const item of entries) {
      const remove = action('Remove from comparison', () => togglePin(item));
      comparison.append(section(item.title, visible.length ? facts(visible.map(([title, value]) =>
        [title, value(item)])) : hint('The displayed fields match.'), remove));
    }
  }

  function togglePin(item) {
    if (pinned.has(item.id)) pinned.delete(item.id);
    else if (pinned.size < 3) pinned.set(item.id, item);
    renderComparison();
    render();
    compareSummary.focus();
  }

  function renderPrevious() {
    const carried = new Set(projection.replacements.values());
    const missing = [...selected].filter(id => !available.has(id) && !carried.has(id));
    previous.hidden = !data.hostMode || data.hostMode === 'unavailable' || !missing.length;
    if (previous.hidden) return;
    const list = node('ul', null, 'ix-stack');
    for (const id of missing) {
      const row = node('li', null, 'ix-picker-row');
      const remove = action('Remove choice', () => {
        selected.delete(id);
        if (saveChoices()) render();
        if (previous.hidden) search.focus();
        else previous.querySelector('summary').focus();
      });
      remove.setAttribute('aria-label', `Remove choice ${id}`);
      row.append(node('code', id), remove);
      list.append(row);
    }
    previous.replaceChildren(node('summary', 'Previously chosen items need review'),
      hint('These choices remain saved. To replace one, remove the old choice and select an item from the current Catalog.'), list);
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const items = data.items.filter(item => (!frameworks.value || item.framework === frameworks.value) &&
      (!categories.value || itemCategory(item) === categories.value) &&
      (!kinds.value || item.kind === kinds.value) &&
      (!q || [item.title, item.description, item.itemId, item.frameworkName].some(value => value?.toLowerCase().includes(q))));
    const maxPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
    page = Math.min(page, maxPage);
    clear.disabled = !filterControls.some(control => control.value);
    const hasInventory = data.items.length > 0 || !data.gaps.catalog;
    resultStatus.textContent = items.length ? `${items.length} matching ${items.length === 1 ? 'item' : 'items'}`
      : hasInventory ? 'No items match these filters.' : '';
    result.replaceChildren();
    visibleChoices.clear();
    const framework = items.length ? collections.get(frameworks.value) : undefined;
    if (framework) result.append(node('h4', `${framework.name} · ${categoryLabel(categoryOf(framework))}`, 'ix-catalog-collection'));
    for (const item of items.slice(page * pageSize, (page + 1) * pageSize)) {
      const row = node('div', null, 'ix-picker-row');
      const retained = projection.replacements.get(item.id);
      const label = checkbox(item.title, selected.has(item.id) || !!retained, value => {
        if (value) selected.add(item.id);
        else selected.delete(retained ?? item.id);
        if (saveChoices()) {
          render();
          visibleChoices.get(item.id)?.focus();
        }
      });
      const input = label.querySelector('input');
      visibleChoices.set(item.id, input);
      const copy = node('div', null, 'ix-stack');
      const metadata = framework ? typeLabel(item.kind) : [item.frameworkName, categoryLabel(itemCategory(item)), typeLabel(item.kind)].join(' · ');
      copy.append(label, hint(metadata));
      if (itemNames.get(itemNameKey(item)) > 1) {
        input.setAttribute('aria-label', `${item.title} · ${item.itemId}`);
        copy.append(hint(item.itemId));
      }
      if (retained) {
        const useCurrent = action('Use current version', () => {
          selected.delete(retained);
          selected.add(item.id);
          saveChoices();
          render();
          visibleChoices.get(item.id)?.focus();
        });
        useCurrent.setAttribute('aria-label', `Use current version for ${item.title}`);
        copy.append(hint(`Choice retained. Your draft still pins ${retained.slice(0, 8)}.`), useCurrent);
      }
      const controls = node('div', null, 'ix-buttons');
      const pin = action(pinned.has(item.id) ? 'Unpin' : 'Pin for comparison', () => togglePin(item));
      pin.setAttribute('aria-label', (pinned.has(item.id) ? 'Unpin ' : 'Pin for comparison: ') + item.title);
      pin.disabled = !pinned.has(item.id) && pinned.size >= 3;
      controls.append(action('Inspect', () => inspect(item)), pin);
      if (toolRecipes.has(item)) controls.append(link('Tool Setup', api.route('tools')));
      row.append(copy, controls);
      result.append(row);
    }
    if (maxPage > 0) {
      const nav = node('div', null, 'ix-buttons');
      const prev = action('Previous', () => { page--; render(); });
      const next = action('Next', () => { page++; render(); });
      prev.disabled = page === 0;
      next.disabled = page === maxPage;
      nav.append(prev, hint((page + 1) + ' / ' + (maxPage + 1)), next);
      result.append(nav);
    }
  }

  for (const control of filterControls) {
    control.addEventListener('input', () => { page = 0; render(); });
  }
  grid.append(result, inspector);
  host.append(filters, filterSummary);
  if (sourceStatus.textContent) host.append(sourceStatus);
  host.append(previous, compare, grid);
  renderPrevious();
  renderComparison();
  render();
}
