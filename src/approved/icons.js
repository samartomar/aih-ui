const ns = 'http://www.w3.org/2000/svg';
const paths = {
  org: 'M7 2.5h6v4H7z M10 6.5v4 M4.5 13v-2.5h11V13 M2.5 13h4v4.5h-4z M13.5 13h4v4.5h-4z',
  policy: 'M10 2.5c2.3 1.4 4.4 2 6.5 2v5.1c0 3.2-2.2 6-6.5 8.1-4.3-2.1-6.5-4.9-6.5-8.1V4.5c2.1 0 4.2-.6 6.5-2z M7.5 8h5 M7.5 11h3',
  versions: 'M2.5 7 10 3l7.5 4-7.5 4z M2.5 10.5l7.5 4 7.5-4 M2.5 14l7.5 4 7.5-4',
  catalog: 'M2.5 4h4v12.5h-4z M6.5 4h4v12.5h-4z M11.3 5l3.5-1 3.1 11.5-3.5 1z M3 7h3 M7 13.5h3',
  byo: 'M3 10v5.5c0 .8.7 1.5 1.5 1.5h11c.8 0 1.5-.7 1.5-1.5V10 M3 12h4l1.2 2h3.6l1.2-2h4 M10 2.5v7 M6.8 6.4 10 9.7l3.2-3.3',
  scan: 'M2.5 7V4A1.5 1.5 0 0 1 4 2.5h3 M13 2.5h3A1.5 1.5 0 0 1 17.5 4v3 M17.5 13v3a1.5 1.5 0 0 1-1.5 1.5h-3 M7 17.5H4A1.5 1.5 0 0 1 2.5 16v-3 M2.5 10h15 M7 7h4 M9 13h4',
  review: 'M7 4.5H4.5v13h11v-13H13 M7 3h6v3H7z M7 11l2 2.2 4-4.5',
  publish: 'M3.5 13.5v2A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-2 M10 13V2.8 M5.8 7 10 2.8 14.2 7',
  clients: 'M3 5.5h11.5v9H3z M6 2.5h10a1.5 1.5 0 0 1 1.5 1.5v7.5 M5.5 8l2 2-2 2 M9 12h2.5',
  setup: 'M2.5 6h3 M10.5 6h7 M2.5 14h7 M14.5 14h3 M10.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z M14.5 14a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z',
  start: 'M9 3.5H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 16.5h5 M7 10h10 M13 6l4 4-4 4',
  tools: 'M16.8 3.4l-3.6 3.5-1.8-1.8L15 1.8a5 5 0 0 0-6 6.3l-5.9 6a2.1 2.1 0 0 0 3 3L12 11a5 5 0 0 0 4.8-7.6z',
  files: 'M2.5 5A1.5 1.5 0 0 1 4 3.5h4l2 2h5a1.5 1.5 0 0 1 1.5 1.5v1 M2.5 5v10A1.5 1.5 0 0 0 4 16.5h11a1.5 1.5 0 0 0 1.5-1.3L18 8H6l-1.5 2',
  profiles: 'M3.5 4h13A1.5 1.5 0 0 1 18 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5v-9A1.5 1.5 0 0 1 3.5 4z M9.4 8a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 1 1 3.4 0z M4.8 13.1c.7-2.6 5.1-2.6 5.8 0 M12.5 8h2.7 M12.5 11h2',
  preview: 'M2 10c2.3-3.7 5-5.5 8-5.5s5.7 1.8 8 5.5c-2.3 3.7-5 5.5-8 5.5S4.3 13.7 2 10z M12.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z',
  diagnostics: 'M2.5 3v13.5h15 M4.5 11h2l2-5.5 3.2 8L14 9h3.5',
  light: 'M10 5.2c-2-1.5-4.6-1.8-7.5-1.3v11.5c2.9-.5 5.5-.2 7.5 1.3 2-1.5 4.6-1.8 7.5-1.3V3.9c-2.9-.5-5.5-.2-7.5 1.3z M10 5.2v11.5',
  sun: 'M13.5 10a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0z M10 2v2 M10 16v2 M2 10h2 M16 10h2 M4.3 4.3l1.4 1.4 M14.3 14.3l1.4 1.4 M4.3 15.7l1.4-1.4 M14.3 5.7l1.4-1.4',
  play: 'M6.5 3.8 16 10l-9.5 6.2z',
  pause: 'M7 4.5v11 M13 4.5v11',
  caution: 'M10 2.8 18 16.8H2z M10 7.5v4.2 M10 14.1v.1',
  stop: 'M6.5 2.5h7l4 4v7l-4 4h-7l-4-4v-7z M6.7 10h6.6',
  unknown: 'M10 2.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 1 0 0-14.8z M7 10h6',
  'arrow-right': 'M3 10h13.5 M11.5 5l5 5-5 5',
  'arrow-up-right': 'M5 15 15.5 4.5 M7 4.5h8.5V13'
};
const aliases = {
  organization:'org', content:'catalog', 'self-scan':'scan', book:'light',
  arrow:'arrow-right', shortcut:'arrow-up-right'
};

function make(name, {size = 18, tone} = {}) {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'ix-icon');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-linecap', 'round');
  if (tone) svg.setAttribute('data-tone', tone);

  const key = Object.hasOwn(aliases, name) ? aliases[name] : name;
  if (Object.hasOwn(paths, key)) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', paths[key]);
    svg.append(path);
  }
  return svg;
}

export {make};
