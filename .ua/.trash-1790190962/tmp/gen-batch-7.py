import json
P = 'prototype/screens/'
N = []
E = []


def fn(path, summ, tags, cx='moderate', lang=None):
    n = {'id': f'file:{P}{path}', 'type': 'file', 'name': path, 'filePath': P + path,
         'summary': summ, 'tags': tags, 'complexity': cx}
    if lang:
        n['languageNotes'] = lang
    N.append(n)


def e(s, t, ty, w):
    E.append({'source': s, 'target': t, 'type': ty, 'direction': 'forward', 'weight': w})


def f(path, name, lr, summ, tags):
    i = f'function:{P}{path}:{name}'
    N.append({'id': i, 'type': 'function', 'name': name, 'filePath': P + path, 'lineRange': lr,
              'summary': summ, 'tags': tags, 'complexity': 'moderate'})
    e(f'file:{P}{path}', i, 'contains', 1.0)


fn('admin-acme.html', "Admin prototype screen for \"Acme additions\": the organization's own source listing internal MCP servers, skills and tools with their scan status, and the only place an admin runs a scan themselves.", ['prototype', 'admin-screen', 'html-page', 'design-source'])
fn('admin-changes.html', "Admin prototype screen showing the staged policy delta (acme.policy.json) as a colorized JSON diff against the template, with reset, copy, download and publish actions.", ['prototype', 'admin-screen', 'policy-diff', 'design-source'], lang="Renders the diff from an inline LINES array with a tiny esc/paint JSON highlighter instead of a library.")
fn('admin-item.html', "Admin prototype screen for a single catalog item's security view (fal-ai-media), showing findings, per-scanner results and source evidence behind a needs-review hold.", ['prototype', 'admin-screen', 'security-scan', 'design-source'])
fn('admin-org.html', "Admin prototype first-run screen where the organization identifies itself (name, id, policy repo, owners prefilled from git) alongside the five-step onboarding path.", ['prototype', 'admin-screen', 'onboarding', 'design-source'])
fn('admin-scan.html', "Admin prototype scan-review screen summarizing scan results across every aih-shipped source (passed, needs review, not scanned) with grouping and an explanation of what each result means.", ['prototype', 'admin-screen', 'security-scan', 'design-source'])
fn('admin-sources.html', "The owner's final, self-contained admin Sources prototype: a full workbench layout with a collapsible nav rail, source card grid, item inspector drawer (details, security scan, policy JSON tabs), organization modal and theme toggle; the origin of the shared tokens and base styles.", ['prototype', 'admin-screen', 'design-source', 'design-system', 'interactive-mock'], 'complex', "Embeds its own inline Tailwind CDN config mapping Material-style colour roles to CSS variables from tokens.css, and wires interactions with IIFE scripts exposing window.* handlers.")
fn('entry.html', "Prototype landing screen shown when the workbench command runs in a folder that is neither a policy repo nor a project, letting the operator choose the admin page or the user page.", ['prototype', 'entry-point', 'design-source', 'html-page'], 'simple')
fn('fonts.css', "Imports the Inter, JetBrains Mono and Material Symbols Outlined web fonts from Google Fonts for every prototype screen.", ['stylesheet', 'typography', 'fonts', 'design-system'], 'simple')
fn('overview.html', "Prototype overview explaining who uses the workbench: the two doors (admin and user), what aih ships, and the two plain policy files that travel between organization and project repos.", ['prototype', 'documentation', 'design-source', 'overview'])
fn('system.html', "Design-system reference screen showcasing the shared tokens and components: colour roles, type, actions and controls, labels/status/filters, navigation and cards.", ['prototype', 'design-system', 'style-guide', 'design-source'])
fn('tokens.css', "Design tokens for the Policy Workbench extracted from admin-sources.html: colour-role CSS custom properties for dark (default) and light modes plus typography conventions.", ['design-tokens', 'stylesheet', 'theming', 'design-system'], 'moderate', "CSS custom properties keyed on html.dark/html.light and [data-mode] selectors provide theme switching without separate stylesheets.")
fn('user-start.html', "User-side prototype screen for picking a starting policy for a project (payments-api) and explaining how a trimmed aih-project-policy.json is shared with teammates via aih init --apply.", ['prototype', 'user-screen', 'onboarding', 'design-source'])
fn('user-trim.html', "Interactive user-side prototype for trimming an organization policy: users toggle sources and items by kind, see ledger counts, overlap and broken-link warnings, and a change log before saving the project policy.", ['prototype', 'user-screen', 'interactive-mock', 'design-source'], 'complex', "Single inline IIFE with a mutable state object and full re-render functions (renderLedger/renderRail/renderMain/renderSide) that build HTML strings.")
fn('wb.css', "Shared base styles for every prototype screen, lifted from admin-sources.html: full-height layout, thin scrollbars, collapsible panel transitions and small utility classes driven by tokens.css variables.", ['stylesheet', 'base-styles', 'layout', 'design-system'])

f('user-trim.html', 'renderLedger', [167, 194], "Renders the ledger tiles summarizing kept versus offered counts per kind, flashing counts that just changed.", ['rendering', 'ui', 'prototype'])
f('user-trim.html', 'renderRail', [196, 209], "Renders the left rail listing the sources in the policy with their kept/offered counts.", ['rendering', 'navigation', 'prototype'])
f('user-trim.html', 'renderMain', [211, 228], "Renders the main panel of item cards for the selected source, filtered by the active kind.", ['rendering', 'ui', 'prototype'])
f('user-trim.html', 'card', [230, 241], "Builds the HTML card for one catalog item with its toggle state and warnings.", ['rendering', 'component', 'prototype'])
f('user-trim.html', 'renderSide', [243, 264], "Renders the side panel of warnings (overlaps, broken links) and the recent change log.", ['rendering', 'validation', 'prototype'])
f('admin-sources.html', 'toggleLeftNav', [287, 299], "Collapses or expands the left navigation rail by swapping width classes.", ['event-handler', 'layout', 'prototype'])
f('admin-sources.html', 'toggleInspector', [304, 316], "Opens or closes the item inspector rail on the right side.", ['event-handler', 'layout', 'prototype'])
f('admin-sources.html', 'applyTheme', [520, 544], "Switches the page between dark and light mode by toggling html classes and the theme button icon.", ['theming', 'event-handler', 'prototype'])

html = ['admin-acme', 'admin-changes', 'admin-item', 'admin-org', 'admin-scan', 'entry', 'overview', 'system', 'user-start', 'user-trim']
for h in html:
    for c in ['fonts.css', 'tokens.css', 'wb.css']:
        e(f'file:{P}{h}.html', f'file:{P}{c}', 'depends_on', 0.6)
    e(f'file:{P}{h}.html', f'file:{P}mode.js', 'depends_on', 0.6)
    e(f'file:{P}{h}.html', f'file:{P}tw-config.js', 'depends_on', 0.6)
e(f'file:{P}admin-sources.html', f'file:{P}tokens.css', 'depends_on', 0.6)
e(f'file:{P}admin-sources.html', f'file:{P}mode.js', 'depends_on', 0.6)
for h in ['admin-acme', 'admin-changes', 'admin-item', 'admin-scan', 'admin-org']:
    e(f'file:{P}{h}.html', f'file:{P}shell.js', 'depends_on', 0.6)
for h in ['user-start', 'user-trim']:
    e(f'file:{P}{h}.html', f'file:{P}user-shell.js', 'depends_on', 0.6)
e(f'file:{P}tokens.css', f'file:{P}admin-sources.html', 'related', 0.5)
e(f'file:{P}wb.css', f'file:{P}tokens.css', 'depends_on', 0.6)
e(f'file:{P}system.html', f'file:{P}admin-sources.html', 'related', 0.5)
e(f'file:{P}user-start.html', f'file:{P}user-trim.html', 'related', 0.5)
e(f'file:{P}entry.html', f'file:{P}overview.html', 'related', 0.5)
json.dump({'nodes': N, 'edges': E}, open('D:/dev/aih-ui/.ua/intermediate/batch-7.json', 'w'), indent=1)
print(len(N), len(E))
