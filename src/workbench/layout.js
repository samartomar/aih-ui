/* Presentation preferences only: no setup, policy or execution state. */
'use strict';
(function () {
  const workspace = document.querySelector('.workspace');
  const rail = document.getElementById('navigation-pane');
  const inspector = document.getElementById('selection-pane');
  if (!workspace || !rail || !inspector) return;

  const storageKey = 'workbench-prototype-layout-v1';
  const regionSelector = 'pre, textarea, .preview-selection-list, .report-table, .inline-inspector-body';
  const regions = new WeakMap();
  const dividers = [
    { node: document.getElementById('navigation-divider'), pane: rail, key: 'rail', min: 140, max: 360, direction: 1 },
    { node: document.getElementById('inspector-divider'), pane: inspector, key: 'inspector', min: 220, max: 560, direction: -1 },
  ];
  let preferences = readPreferences();
  let scheduled = false;
  let refreshExisting = false;
  let drag = null;
  let nativeResize = null;

  function readPreferences() {
    const result = { regions: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved || typeof saved !== 'object') return result;
      if (saved.regions && typeof saved.regions === 'object' && !Array.isArray(saved.regions)) result.regions = saved.regions;
      if (Number.isFinite(saved.rail)) result.rail = saved.rail;
      if (Number.isFinite(saved.inspector)) result.inspector = saved.inspector;
    } catch (error) {
      // Layout remains usable when browser storage is unavailable.
    }
    return result;
  }

  function remember() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch (error) {
      // These optional preferences never affect Workbench state.
    }
  }

  function announce(text) {
    document.getElementById('layout-announcement').textContent = text;
  }

  function currentWidth(part) {
    return Math.round(part.pane.getBoundingClientRect().width);
  }

  function limits(part) {
    const other = dividers.find(value => value !== part);
    const gaps = part.node.getBoundingClientRect().width + other.node.getBoundingClientRect().width;
    const available = workspace.clientWidth - currentWidth(other) - 280 - gaps;
    return { min: part.min, max: Math.max(part.min, Math.min(part.max, available)) };
  }

  function setWidth(part, width, save) {
    const range = limits(part);
    const value = Math.max(range.min, Math.min(range.max, Math.round(width)));
    workspace.style.setProperty('--' + part.key + '-width', value + 'px');
    part.node.setAttribute('aria-valuenow', String(value));
    part.node.setAttribute('aria-valuemax', String(range.max));
    if (save) {
      preferences[part.key] = value;
      remember();
    }
    return value;
  }

  function updateWidths() {
    if (window.matchMedia('(max-width:820px)').matches) return;
    dividers.forEach(part => {
      if (Number.isFinite(preferences[part.key])) setWidth(part, preferences[part.key], false);
      const range = limits(part);
      if (currentWidth(part) > range.max) setWidth(part, range.max, false);
      part.node.setAttribute('aria-valuenow', String(currentWidth(part)));
      part.node.setAttribute('aria-valuemax', String(range.max));
    });
  }

  function syncDividerValues() {
    dividers.forEach(part => {
      part.node.setAttribute('aria-valuenow', String(currentWidth(part)));
      part.node.setAttribute('aria-valuemax', String(limits(part).max));
    });
  }

  dividers.forEach(part => {
    part.node.addEventListener('pointerdown', event => {
      if (window.matchMedia('(max-width:820px)').matches || event.button !== 0) return;
      event.preventDefault();
      drag = { part, x: event.clientX, width: currentWidth(part) };
      part.node.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-panes');
    });
    part.node.addEventListener('pointermove', event => {
      if (drag && drag.part === part) setWidth(part, drag.width + (event.clientX - drag.x) * part.direction, false);
    });
    function stop() {
      if (!drag || drag.part !== part) return;
      const value = setWidth(part, currentWidth(part), true);
      drag = null;
      document.body.classList.remove('resizing-panes');
      announce(part.node.getAttribute('aria-label') + ' ' + value + ' pixels.');
      schedule(true);
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => part.node.addEventListener(type, stop));
    part.node.addEventListener('keydown', event => {
      const range = limits(part);
      const step = event.shiftKey ? 40 : 10;
      let width = currentWidth(part);
      if (event.key === 'ArrowLeft') width -= step * part.direction;
      else if (event.key === 'ArrowRight') width += step * part.direction;
      else if (event.key === 'Home') width = range.min;
      else if (event.key === 'End') width = range.max;
      else return;
      event.preventDefault();
      const value = setWidth(part, width, true);
      announce(part.node.getAttribute('aria-label') + ' ' + value + ' pixels.');
      schedule(true);
    });
  });

  function labelFor(node) {
    if (node.tagName === 'TEXTAREA') {
      const label = node.id && document.querySelector('label[for="' + node.id + '"]');
      return label ? label.textContent.trim() : 'Text editor';
    }
    if (node.tagName === 'PRE') return 'Code / JSON';
    if (node.classList.contains('preview-selection-list')) return 'Selected items';
    if (node.classList.contains('report-table')) return 'Report rows';
    return 'Selected item details';
  }

  function createToolbar(node) {
    const tools = document.createElement('div');
    tools.className = 'region-size-tools';
    const title = document.createElement('span');
    title.textContent = labelFor(node);
    tools.appendChild(title);
    const actions = [
      ['smaller', '−', 'Reduce height'],
      ['larger', '+', 'Increase height'],
      ['expand', 'Expand', 'Expand or collapse content'],
    ];
    actions.forEach(([command, text, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.layoutCommand = command;
      button.textContent = text;
      button.setAttribute('aria-label', label + ' · ' + labelFor(node));
      tools.appendChild(button);
    });
    node.parentNode.insertBefore(tools, node);
    return tools;
  }

  function applySize(node, region) {
    const setting = preferences.regions[region.key];
    const expanded = !!(setting && setting.expanded);
    let height = region.defaultHeight + 'px';
    if (expanded) {
      if (node.tagName === 'TEXTAREA') {
        node.style.height = 'auto';
        height = Math.max(85, node.scrollHeight + 2) + 'px';
      } else height = 'auto';
    } else if (setting && Number.isFinite(setting.height)) {
      height = Math.max(64, Math.min(1600, setting.height)) + 'px';
    }
    if (node.style.maxHeight !== 'none') node.style.maxHeight = 'none';
    if (node.style.height !== height) node.style.height = height;
    node.classList.toggle('layout-expanded', expanded);
    const expand = region.toolbar.querySelector('[data-layout-command="expand"]');
    const text = expanded ? 'Collapse' : 'Expand';
    if (expand.textContent !== text) expand.textContent = text;
    expand.setAttribute('aria-expanded', String(expanded));
  }

  function refreshRegion(node, region) {
    if (!node.getClientRects().length) return;
    const setting = preferences.regions[region.key];
    if (!setting) {
      // Measure the original layout first. Short previews keep their natural size.
      node.classList.remove('layout-region', 'layout-expanded');
      node.style.height = region.originalHeight;
      node.style.maxHeight = region.originalMaxHeight;
      const overflowing = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
      if (node.tagName !== 'TEXTAREA' && !overflowing) {
        if (region.toolbar) region.toolbar.remove();
        region.toolbar = null;
        return;
      }
      region.defaultHeight = Math.max(64, Math.round(node.getBoundingClientRect().height));
    }
    node.classList.add('layout-region');
    if (node.tagName !== 'TEXTAREA') {
      node.tabIndex = 0;
      node.setAttribute('role', 'region');
      node.setAttribute('aria-label', labelFor(node));
    }
    if (!region.toolbar) region.toolbar = createToolbar(node);
    applySize(node, region);
  }

  function enhance() {
    scheduled = false;
    const refresh = refreshExisting;
    refreshExisting = false;
    const active = document.querySelector('.rail nav [aria-current="page"]');
    const view = active ? active.dataset.view : 'catalog';
    workspace.querySelectorAll(regionSelector).forEach((node, index) => {
      let region = regions.get(node);
      if (!region) {
        const context = node.closest('.inspector') ? 'inspector' : view;
        region = {
          key: context + ':' + (node.id || node.tagName.toLowerCase() + ':' + index),
          originalHeight: node.style.height,
          originalMaxHeight: node.style.maxHeight,
          defaultHeight: 160,
          toolbar: null,
        };
        regions.set(node, region);
        node.dataset.layoutKey = region.key;
        refreshRegion(node, region);
      } else if (refresh || !region.toolbar) refreshRegion(node, region);
    });
  }

  function schedule(refresh) {
    refreshExisting = refreshExisting || refresh === true;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhance);
  }

  // Handle layout controls before Workbench's page action listener.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-layout-command], #layout-reset');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.id === 'layout-reset') {
      preferences = { regions: {} };
      workspace.style.removeProperty('--rail-width');
      workspace.style.removeProperty('--inspector-width');
      remember();
      updateWidths();
      schedule(true);
      requestAnimationFrame(syncDividerValues);
      announce('Layout reset.');
      return;
    }
    const node = button.parentElement.nextElementSibling;
    const region = node && regions.get(node);
    if (!region) return;
    const setting = preferences.regions[region.key] || {};
    const command = button.dataset.layoutCommand;
    if (command === 'expand') {
      preferences.regions[region.key] = { expanded: !setting.expanded, height: setting.height || node.getBoundingClientRect().height };
    } else {
      const change = command === 'larger' ? 100 : -100;
      preferences.regions[region.key] = { height: Math.max(64, Math.min(1600, node.getBoundingClientRect().height + change)), expanded: false };
    }
    applySize(node, region);
    remember();
    announce(labelFor(node) + (preferences.regions[region.key].expanded ? ' expanded.' : ' height ' + Math.round(node.getBoundingClientRect().height) + ' pixels.'));
  }, true);

  document.addEventListener('pointerdown', event => {
    const node = event.target.closest('.layout-region');
    if (!node || node.classList.contains('layout-expanded')) return;
    const rect = node.getBoundingClientRect();
    if (event.clientX > rect.right - 24 && event.clientY > rect.bottom - 24) nativeResize = node;
  }, true);
  document.addEventListener('pointerup', () => {
    if (!nativeResize) return;
    preferences.regions[nativeResize.dataset.layoutKey] = { height: Math.round(nativeResize.getBoundingClientRect().height), expanded: false };
    remember();
    nativeResize = null;
  }, true);
  document.addEventListener('input', event => {
    const region = regions.get(event.target);
    if (region && preferences.regions[region.key]?.expanded) applySize(event.target, region);
  });
  document.addEventListener('toggle', () => schedule(true), true);
  window.addEventListener('resize', () => {
    updateWidths();
    schedule(true);
  });
  new MutationObserver(mutations => {
    const contentChanged = mutations.some(mutation => {
      if (mutation.target.closest('.region-size-tools')) return false;
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      return changed.some(node => node.nodeType !== 1 || !node.classList.contains('region-size-tools'));
    });
    if (contentChanged) schedule(true);
  }).observe(workspace, { childList: true, subtree: true });

  // CSS layout and transitions can settle after the reset click handler returns.
  // Keep both separators' accessible values tied to their measured pane widths.
  const paneObserver = new ResizeObserver(syncDividerValues);
  dividers.forEach(part => paneObserver.observe(part.pane));

  updateWidths();
  // Retain supported pane/region sizes while dropping retired preferences.
  remember();
  schedule();
})();
