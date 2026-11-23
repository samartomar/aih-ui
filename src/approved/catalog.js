import { evidenceDetails } from './scan.js';
import { action, checkbox, facts, field, hint, node, section } from './dom.js';

export function renderCatalog(host, api, current, update) {
  const data = api.data;
  const grid = node('div', null, 'ix-catalog-grid');
  const result = node('div', null, 'ix-catalog-list ix-stack');
  const inspector = section('Quick Look', hint('Inspect an item to see its published source, compatibility and Scan evidence.'));
  const filters = node('div', null, 'ix-catalog-filters');
  const search = node('input');
  search.type = 'search';
  const frameworks = node('select');
  frameworks.append(new Option('All frameworks', ''));
  for (const framework of data.frameworks) frameworks.append(new Option(framework.name, framework.id));
  const kinds = node('select');
  kinds.append(new Option('All kinds', ''));
  for (const kind of new Set(data.items.map(item => item.kind))) kinds.append(new Option(kind, kind));
  filters.append(field('Search Catalog', search), field('Framework', frameworks), field('Kind', kinds));
  let page = 0;
  let request = 0;
  const selected = new Set(current);
  const pageSize = 8;

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
      ['Kind', item.kind],
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

  function render() {
    const q = search.value.trim().toLowerCase();
    const items = data.items.filter(item => (!frameworks.value || item.framework === frameworks.value) &&
      (!kinds.value || item.kind === kinds.value) &&
      (!q || [item.title, item.description, item.itemId, item.frameworkName].some(value => value?.toLowerCase().includes(q))));
    const maxPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
    page = Math.min(page, maxPage);
    result.replaceChildren(hint(data.gaps.catalog ?? (items.length ? items.length + ' matching items' : 'No items match these choices.')));
    for (const item of items.slice(page * pageSize, (page + 1) * pageSize)) {
      const row = node('div', null, 'ix-picker-row');
      const label = checkbox(item.title, selected.has(item.id), value => {
        if (value) selected.add(item.id);
        else selected.delete(item.id);
        update([...selected]);
      });
      const copy = node('div', null, 'ix-stack');
      copy.append(label, hint(item.frameworkName + ' · ' + item.kind));
      row.append(copy, action('Inspect', () => inspect(item)));
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

  for (const control of [search, frameworks, kinds]) {
    control.addEventListener('input', () => { page = 0; render(); });
  }
  grid.append(result, inspector);
  host.append(filters, grid);
  render();
}
