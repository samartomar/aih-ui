/*
 * Sources & Catalogs, wired to the installed @aihq/catalog index.
 *
 * This module owns presentation and view state only. Every displayed value comes from
 * catalog-index.json or summary.json, both produced by tools/preview.mjs from the installed
 * package. Catalog strings are inserted with textContent; nothing from the catalog is parsed
 * as HTML. Where the prototype showed a field the index does not publish, the layout is kept,
 * the page says "Not published", and the control is disabled.
 *
 * Source identity is read from the source.type discriminator, never from what happens to be
 * present: a github source is a repository + commit + path, an npm source is a registry +
 * package + version + integrity, and an aih source is its published release + revision. A
 * commit is never rendered as a version, and a version is never invented for a field the
 * index does not carry.
 */

import { collectGovernanceDom, governanceSelect } from "./governance.js";

const NOT_PUBLISHED = "Not published";
/* Three different absences, kept apart on purpose:
   - NOT_PUBLISHED: a package field the index genuinely does not carry.
   - NOT_SUPPLIED: organization information. Organizations supply it; the catalog never will.
   - NOT_CONNECTED: an action or telemetry feed with no Core contract wired yet. */
const NOT_SUPPLIED = "Not supplied";
const NOT_CONNECTED = "Not connected";
const INDEX_URL = "./catalog-index.json";
const SUMMARY_URL = "./summary.json";
const EXPECTED_FORMAT = "aih-catalog-index";
const EXPECTED_VERSION = 1;
/* Nested source row that filters by source identity without naming one, used when a source
   type publishes its entries under a single identity (the npm package, for example). */
const DISTINCT_SOURCES = "__distinct__";
/* Separates the parts of a nested source filter: type, source identity, revision. */
const FILTER_SEPARATOR = "\u0000";

const IDENTITY_KEYS = ["entryId", "subjectId", "kind", "sourceType", "sourceLabel", "revision"];

/* Prototype order of the six-kind ledger. Kinds the index carries are counted; the rest keep
   the layout and say Not published. */
const LEDGER = [
  { key: "skill", label: "Skills", icon: "extension", color: "#f59e0b" },
  { key: null, label: "Commands", icon: "terminal", color: "#38bdf8" },
  { key: "agent", label: "Agents", icon: "smart_toy", color: "#c084fc" },
  { key: "mcp", label: "MCP Servers", icon: "dns", color: "#60a5fa" },
  { key: null, label: "Hook Events", icon: "webhook", color: "#34d399" },
  { key: null, label: "Token Budget", icon: "toll", color: "#f97316" },
];

const KIND_ICON = { skill: "extension", agent: "smart_toy", mcp: "dns", package: "deployed_code", profile: "badge", tool: "handyman" };

const state = {
  entries: [],
  summary: null,
  view: { query: "", kind: null, sourceType: null, sort: "entryId", source: null },
  selectedId: null,
};

const dom = {};

/* ------------------------------------------------------------------- utilities */

function text(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function row(parent, label, value) {
  const line = el("div", "flex justify-between gap-2");
  line.appendChild(el("span", "shrink-0", label));
  const shown = text(value) ?? NOT_PUBLISHED;
  const valueNode = el("span", shown === NOT_PUBLISHED ? "text-outline/70 text-right" : "text-on-surface text-right break-all", shown);
  line.appendChild(valueNode);
  parent.appendChild(line);
  return line;
}

/* A row whose value is a count of entries rather than a package field: the page computed it,
   so an empty list reads as zero and never borrows the "Not published" wording. */
function countRow(parent, label, value, suffix = "") {
  const line = el("div", "flex justify-between gap-2");
  line.appendChild(el("span", "shrink-0", label));
  line.appendChild(el("span", "text-on-surface text-right break-all", `${value}${suffix}`));
  parent.appendChild(line);
  return line;
}

function field(container, label, value, icon, tone) {
  const line = el("div", "p-2 rounded bg-surface-container-low border border-surface-container-high/30 flex items-center justify-between gap-2");
  const left = el("div", "flex items-center gap-1.5 text-on-surface");
  if (icon) left.appendChild(el("span", `material-symbols-outlined text-[14px] text-${tone ?? "outline"}`, icon));
  left.appendChild(el("span", "", label));
  line.appendChild(left);
  const shown = text(value) ?? NOT_PUBLISHED;
  line.appendChild(el("span", `font-mono text-[10px] text-right break-all ${shown === NOT_PUBLISHED ? "text-outline/70" : `text-${tone ?? "outline"}`}`, shown));
  container.appendChild(line);
  return line;
}

function chip(label, value, tone) {
  const node = el("span", "px-2 py-0.5 rounded bg-surface-container border border-surface-container-high/40 text-on-surface-variant flex items-center gap-1.5 text-[10.5px]");
  node.appendChild(el("span", "text-outline uppercase", label));
  node.appendChild(el("span", `font-semibold ${tone ?? "text-on-surface"}`, value));
  return node;
}

/* -------------------------------------------------------------- source identity */

/* A published revision, shortened for display. Raw revision digests keep their "sha256:"
   prefix in the index; the inspector shows one of the two consistently, and says the digest
   is abbreviated instead of passing a short hash off as the whole value. */
function shortDigest(value) {
  const digest = text(value);
  if (digest === null) return null;
  const hex = digest.replace(/^sha256:/, "");
  return hex.slice(0, 12);
}

/* Identity fields per source.type. `revision` is the only value the page calls a revision:
   a git commit for github, the published revision for aih, the SRI integrity for npm (an npm
   tarball has no commit, so the commit row stays Not published). */
function sourceIdentity(entry) {
  const source = entry?.subject?.source;
  if (source === null || typeof source !== "object") {
    return { type: "unknown", repository: null, commit: null, path: null, packageName: null, registry: null, version: null, integrity: null, release: null, revision: null };
  }
  const type = text(source.type) ?? "unknown";
  const repository = text(source.repository);
  const commit = text(source.commit);
  const sourcePath = text(source.path);
  const packageName = text(source.package);
  const registry = text(source.registry);
  const version = text(source.version);
  const integrity = text(source.integrity);
  const release = text(source.release);
  const revision = type === "github" ? commit : type === "npm" ? integrity : text(source.revision) ?? commit;
  return { type, repository, commit, path: sourcePath, packageName, registry, version, integrity, release, revision };
}

/* The one line that names the source identity this entry came from. */
function sourceLabelOf(source) {
  if (source.type === "github") return source.repository ?? source.commit;
  if (source.type === "npm") return source.packageName === null ? null : source.version === null ? source.packageName : `${source.packageName}@${source.version}`;
  if (source.type === "aih") return source.release ?? null;
  return source.release ?? source.repository ?? source.packageName ?? source.commit;
}

function sourceLabelTitle(source, label) {
  if (source.type === "github") return `GitHub source: revision ${source.commit ?? "not published"}`;
  if (source.type === "npm") return `npm source: ${source.packageName ?? "package not published"} ${source.version ?? "version not published"}`.trim();
  if (source.type === "aih") return `AIH source: release ${source.release ?? "not published"}`;
  return `Source identity: ${label}`;
}

/* The rows the inspector shows for a source, in the order that source type publishes them. */
function sourceDetailRows(source) {
  if (source.type === "github") {
    return [
      ["Repository", source.repository],
      ["Commit", source.commit],
      ["Path", source.path],
    ];
  }
  if (source.type === "npm") {
    return [
      ["Registry", source.registry],
      ["Package", source.packageName],
      ["Version", source.version],
      ["Integrity", source.integrity],
    ];
  }
  if (source.type === "aih") {
    return [
      ["Release", source.release],
      ["Revision", source.revision],
    ];
  }
  return [
    ["Revision", source.revision],
    ["Repository", source.repository],
    ["Package", source.packageName],
  ];
}

function identity(entry) {
  const source = sourceIdentity(entry);
  const sourceLabel = sourceLabelOf(source);
  return {
    entryId: text(entry?.entryId) ?? "(entryId not published)",
    subjectId: text(entry?.subject?.id) ?? NOT_PUBLISHED,
    kind: text(entry?.subject?.kind) ?? "unknown",
    sourceType: source.type,
    sourceLabel,
    release: sourceLabel,
    revision: source.revision,
  };
}

function entrySource(entry) {
  return sourceIdentity(entry);
}

function statementsOf(entry) {
  const qualification = entry?.qualification ?? {};
  const groups = [["finding", qualification.findings], ["gap", qualification.gaps], ["right", qualification.rights]];
  const statements = [];
  for (const [kind, list] of groups) {
    for (const item of Array.isArray(list) ? list : []) {
      statements.push({
        kind,
        id: text(item?.evidence?.id),
        attestor: text(item?.evidence?.attestor),
        format: text(item?.evidence?.format),
        summary: text(item?.evidence?.summary),
        path: text(item?.path),
        sha256: text(item?.sha256),
      });
    }
  }
  const report = qualification.report;
  if (report && typeof report === "object") {
    statements.push({
      kind: "report",
      id: text(report?.evidence?.id),
      attestor: text(report?.evidence?.attestor),
      format: text(report?.evidence?.format),
      summary: text(report?.evidence?.summary),
      path: text(report?.path),
      sha256: text(report?.sha256),
    });
  }
  return statements;
}

function firstSummary(entry, kinds) {
  const found = statementsOf(entry).find((statement) => kinds.includes(statement.kind) && statement.summary);
  return found ? found.summary : null;
}

/* Everything the search box matches: the published ids and every published identity field of
   the source, so a repository, package, path or commit is findable without a lookup table. */
function searchText(entry) {
  const id = identity(entry);
  const source = entrySource(entry);
  return [
    id.entryId,
    id.subjectId,
    id.kind,
    id.sourceType,
    id.sourceLabel,
    id.revision,
    source.repository,
    source.commit,
    source.path,
    source.packageName,
    source.registry,
    source.version,
    source.integrity,
    source.release,
  ].filter((part) => part !== null).join(" ");
}

/* ---------------------------------------------------------------------- view */

function sourceFilterValue(type, label, revision) {
  return `${type}${FILTER_SEPARATOR}${label}${FILTER_SEPARATOR}${revision}`;
}

function matchesSourceFilter(entry, value) {
  const [type, label, revision] = value.split(FILTER_SEPARATOR);
  const source = entrySource(entry);
  if (source.type !== type) return false;
  const sourceLabel = sourceLabelOf(source);
  if (label === DISTINCT_SOURCES) return true;
  const matchesLabel = label === (sourceLabel ?? NOT_PUBLISHED);
  if (revision) return matchesLabel && revision === (source.revision ?? NOT_PUBLISHED);
  return matchesLabel || revisionOf(entry) === label || source.repository === label || source.packageName === label;
}

/* Kept for callers that read a single revision string off an entry. */
function revisionOf(entry) {
  return entrySource(entry).revision;
}

function visibleEntries() {
  const query = state.view.query.trim().toLocaleLowerCase();
  let rows = state.entries.filter((entry) => {
    const source = entrySource(entry);
    if (state.view.kind && text(entry?.subject?.kind) !== state.view.kind) return false;
    if (state.view.sourceType && source.type !== state.view.sourceType) return false;
    if (state.view.source && !matchesSourceFilter(entry, state.view.source)) return false;
    if (query && !searchText(entry).toLocaleLowerCase().includes(query)) return false;
    return true;
  });
  const direction = state.view.sort.endsWith("-desc") ? -1 : 1;
  const key = state.view.sort.replace("-desc", "");
  rows = rows.sort((a, b) => {
    const left = identity(a)[key] ?? "";
    const right = identity(b)[key] ?? "";
    return left.localeCompare(right) * direction || identity(a).entryId.localeCompare(identity(b).entryId);
  });
  return rows;
}

function countBy(selector) {
  const counts = new Map();
  for (const entry of state.entries) {
    const key = selector(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sortedCounts(counts) {
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/* ------------------------------------------------------------------ rendering */

function renderProvenance() {
  const strip = dom.provenanceStrip;
  strip.replaceChildren();
  const summary = state.summary ?? {};
  const pkg = summary.package ?? {};
  const indexPkg = summary.indexPackage ?? {};
  const parts = [];

  const lead = el("span");
  lead.appendChild(el("span", "material-symbols-outlined text-[14px] text-primary shrink-0 align-middle", "account_tree"));
  parts.push(lead);
  const add = (label, value, tone) => {
    const span = el("span");
    span.appendChild(el("span", "text-on-surface font-medium", `${label} `));
    span.appendChild(el("span", tone ?? "text-outline/80", value));
    parts.push(span);
  };
  add("@aihq/catalog", text(pkg.version) ?? NOT_PUBLISHED);
  add("index", `${text(summary.format) ?? NOT_PUBLISHED} v${text(summary.version) ?? NOT_PUBLISHED}`);
  add("entries", String(state.entries.length));
  // The provenance of this page is a package someone packed on this machine, not a registry
  // release: say which one it is instead of implying a published download.
  add("provenance", "locally packed package", "text-secondary");
  add("tarball", text(pkg.tarball) ?? NOT_PUBLISHED, "text-secondary");
  if (indexPkg?.version && pkg?.version && indexPkg.version !== pkg.version) {
    add("index package version", indexPkg.version, "text-tertiary");
  }
  const mirror = el("span", "px-1.5 py-0.2 rounded bg-surface-container text-outline font-mono text-[10px]", "read-only-mirror");
  parts.push(mirror);
  strip.append(...parts);
}

function tile(kind) {
  const count = kind.key === null ? null : (state.kindCounts.get(kind.key) ?? 0);
  const active = kind.key !== null && state.view.kind === kind.key;
  const button = el("button", `px-4 pt-3 pb-3 flex flex-col gap-2 text-left transition-colors focus:outline-none ${active ? "bg-[#ffb95f]/[0.07] cursor-pointer" : kind.key === null ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-container/50"}`, undefined);
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  if (kind.key === null) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = `Not published: the index carries no ${kind.label.toLowerCase()} entries`;
  }

  const head = el("div", "flex items-center justify-between gap-2 min-w-0");
  const name = el("span", "flex items-center gap-1.5 min-w-0");
  name.appendChild(el("span", `material-symbols-outlined text-[14px]`, kind.icon)).style.color = kind.color;
  name.appendChild(el("span", `text-[10px] uppercase font-semibold tracking-[0.08em] truncate ${active ? "text-white" : "text-outline"}`, kind.label));
  head.appendChild(name);
  head.appendChild(el("span", "text-[10px] font-mono tabular-nums shrink-0 text-outline", count === null ? NOT_PUBLISHED : `${count}`));
  button.appendChild(head);

  const metrics = el("div", "flex items-baseline justify-between gap-2");
  if (count === null) {
    metrics.appendChild(el("span", "text-[13px] leading-none font-semibold font-mono tracking-tight text-outline", NOT_PUBLISHED));
  } else {
    const numbers = el("span", "flex items-baseline gap-1");
    numbers.appendChild(el("span", "text-[22px] leading-none font-semibold font-mono tabular-nums tracking-tight text-white", String(count)));
    metrics.appendChild(numbers);
    metrics.appendChild(el("span", "text-[10px] font-mono tabular-nums whitespace-nowrap text-outline", "inventory count"));
  }
  button.appendChild(metrics);

  const track = el("div", "h-[3px] rounded-full bg-surface-container-highest/70 overflow-hidden");
  if (count !== null && state.entries.length) {
    const bar = el("div", "h-full rounded-full");
    bar.style.width = `${Math.round((count / state.entries.length) * 100)}%`;
    bar.style.background = kind.color;
    track.appendChild(bar);
  }
  button.appendChild(track);

  if (kind.key !== null) {
    button.addEventListener("click", () => {
      state.view.kind = state.view.kind === kind.key ? null : kind.key;
      renderView();
    });
  }
  return button;
}

function renderLedger() {
  dom.frameworkMatrixTabs.replaceChildren(...LEDGER.map(tile));
}

function railRow(label, count, options = {}) {
  const rowNode = el("button", `w-full flex items-center justify-between px-1.5 py-0.5 rounded text-left transition-colors ${options.active ? "bg-surface-container-high text-primary font-medium" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface cursor-pointer"}`, undefined);
  rowNode.type = "button";
  rowNode.setAttribute("aria-pressed", String(Boolean(options.active)));
  rowNode.appendChild(el("span", "truncate", label));
  rowNode.appendChild(el("span", `font-mono text-[10px] ${options.active ? "px-1 rounded bg-tertiary-container text-on-tertiary font-bold" : "text-outline"}`, count === null ? NOT_PUBLISHED : String(count)));
  if (options.title) rowNode.title = options.title;
  if (options.onClick) {
    rowNode.addEventListener("click", options.onClick);
  } else {
    rowNode.disabled = true;
    rowNode.setAttribute("aria-disabled", "true");
    rowNode.classList.add("opacity-50", "cursor-not-allowed");
    rowNode.title = options.title ?? `${NOT_PUBLISHED}: not carried by the installed index`;
  }
  return rowNode;
}

function renderRails() {
  dom.railPackageVersion.textContent = text(state.summary?.package?.version) ?? NOT_PUBLISHED;
  dom.railPackageCount.textContent = String(state.entries.length);
  dom.navSourcesCount.textContent = String(state.entries.length);

  const kindList = dom.railKindList;
  kindList.replaceChildren();
  for (const [kind, count] of sortedCounts(state.kindCounts)) {
    kindList.appendChild(railRow(kind, count, {
      active: state.view.kind === kind,
      onClick: () => {
        state.view.kind = state.view.kind === kind ? null : kind;
        renderView();
      },
    }));
  }
  for (const missing of LEDGER.filter((item) => item.key === null)) {
    kindList.appendChild(railRow(missing.label, null, { title: `Not published: the index carries no ${missing.label.toLowerCase()} entries` }));
  }

  const sourceList = dom.railSourceList;
  sourceList.replaceChildren();
  for (const [sourceType, count] of sortedCounts(state.sourceTypeCounts)) {
    const identities = dom.sourceIdentities.get(sourceType) ?? new Map();
    const activeInType = state.view.sourceType === sourceType || (state.view.source?.startsWith(`${sourceType}${FILTER_SEPARATOR}`) ?? false);
    const panel = el("div", "rounded bg-surface-container-low/60 border border-surface-container-high/40 p-1 space-y-0.5");
    panel.appendChild(railRow(sourceType, count, {
      active: state.view.sourceType === sourceType,
      onClick: () => {
        state.view.sourceType = state.view.sourceType === sourceType ? null : sourceType;
        state.view.source = null;
        renderView();
      },
    }));
    // One nested row per published source identity: the repository for github, the package for
    // npm, the release for aih. A github repository carries many revisions, so when a source
    // type publishes more than one revision under the same identity, that identity also gets
    // one row per revision, and those rows are what make revisions distinguishable.
    if (activeInType) {
      const nested = el("div", "pl-2 space-y-0.5");
      const singleIdentity = identities.size === 1;
      for (const [identityKey, group] of sortedCounts(identities)) {
        const label = identityKey === NOT_PUBLISHED && singleIdentity ? `${sourceType} sources` : identityKey;
        const revisions = sortedCounts(group.revisions);
        const sharedRevision = revisions.length === 1 ? (revisions[0][0] === NOT_PUBLISHED ? "" : revisions[0][0]) : "";
        nested.appendChild(railRow(label, group.total, {
          active: state.view.source === sourceFilterValue(sourceType, identityKey, sharedRevision),
          title: `${sourceType} source identity: ${identityKey}`,
          onClick: () => {
            state.view.source = sourceFilterValue(sourceType, identityKey, sharedRevision);
            state.view.sourceType = null;
            renderView();
          },
        }));
        if (revisions.length > 1) {
          const revisionRows = el("div", "pl-2 space-y-0.5");
          for (const [revision, revisionCount] of revisions) {
            revisionRows.appendChild(railRow(shortDigest(revision) ?? revision, revisionCount, {
              active: state.view.source === sourceFilterValue(sourceType, identityKey, revision),
              title: `${sourceType} source revision: ${revision}`,
              onClick: () => {
                state.view.source = sourceFilterValue(sourceType, identityKey, revision);
                state.view.sourceType = null;
                renderView();
              },
            }));
          }
          nested.appendChild(revisionRows);
        }
      }
      panel.appendChild(nested);
    } else {
      const noun = identities.size === 1 ? "source identity" : "source identities";
      panel.appendChild(el("div", "pl-2 px-1.5 py-0.5 font-mono text-[10px] text-outline", `${identities.size} ${noun}`));
    }
    sourceList.appendChild(panel);
  }
}

function renderFilters() {
  const kinds = sortedCounts(state.kindCounts).map(([kind]) => kind);
  dom.kindFilters.replaceChildren();
  dom.kindFilters.appendChild(kindPill("All Kinds", state.entries.length, state.view.kind === null, () => {
    state.view.kind = null;
    renderView();
  }));
  for (const kind of kinds) {
    dom.kindFilters.appendChild(kindPill(kind, state.kindCounts.get(kind), state.view.kind === kind, () => {
      state.view.kind = state.view.kind === kind ? null : kind;
      renderView();
    }));
  }

  const wanted = state.view.sourceType ?? "";
  if (dom.sourceFilter.dataset.built !== [...state.sourceTypeCounts.keys()].join(",")) {
    dom.sourceFilter.replaceChildren();
    const any = el("option", "", "All Sources");
    any.value = "";
    dom.sourceFilter.appendChild(any);
    for (const [sourceType, count] of sortedCounts(state.sourceTypeCounts)) {
      const option = el("option", "", `${sourceType} (${count})`);
      option.value = sourceType;
      dom.sourceFilter.appendChild(option);
    }
    dom.sourceFilter.dataset.built = [...state.sourceTypeCounts.keys()].join(",");
  }
  dom.sourceFilter.value = wanted;
  dom.sortSelect.value = state.view.sort;
}

function kindPill(label, count, active, onClick) {
  const button = el("button", `px-2.5 py-1 rounded text-[10.5px] font-mono transition-colors shrink-0 ${active ? "bg-surface-container-highest text-on-surface font-semibold shadow-xs" : "hover:bg-surface-container text-on-surface-variant"}`, undefined);
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  button.textContent = `${label} (${count})`;
  button.addEventListener("click", onClick);
  return button;
}

function card(entry) {
  const id = identity(entry);
  const source = entrySource(entry);
  const qual = entry.qualification ?? {};
  const findings = Array.isArray(qual.findings) ? qual.findings.length : null;
  const gaps = Array.isArray(qual.gaps) ? qual.gaps.length : null;
  const isSelected = state.selectedId === id.entryId;

  const node = el("div", `group rounded border p-3 flex flex-col justify-between hover:border-primary transition-all cursor-pointer ${isSelected ? "border-primary" : "border-surface-container-high/60"}`);
  node.dataset.cardId = id.entryId;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-pressed", String(isSelected));

  const top = el("div");
  const head = el("div", "flex items-start justify-between gap-2");
  const name = el("div", "flex items-center gap-1.5 min-w-0");
  name.appendChild(el("span", "material-symbols-outlined text-[15px] text-[#ffb95f]", KIND_ICON[id.kind] ?? "extension"));
  name.appendChild(el("span", "font-mono font-bold text-white text-[13px] tracking-tight truncate", id.entryId));
  head.appendChild(name);
  const badge = el("div", "flex items-center gap-1 shrink-0");
  badge.appendChild(el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-[8.5px] font-mono text-outline/90", id.kind.toUpperCase()));
  head.appendChild(badge);
  top.appendChild(head);

  const summary = firstSummary(entry, ["gap", "finding"]);
  const body = el("p", `text-[11px] mt-2 leading-relaxed line-clamp-3 ${summary ? "text-on-surface-variant" : "text-outline/70"}`);
  if (summary) {
    body.appendChild(el("span", "text-outline", "Evidence: "));
    body.appendChild(document.createTextNode(summary));
    body.title = "Published evidence statement, not a product description";
  } else {
    body.textContent = NOT_PUBLISHED;
    body.title = "Not published: the index carries no description and this entry has no evidence statement";
  }
  top.appendChild(body);
  node.appendChild(top);

  const foot = el("div", "pt-2.5 mt-2.5 border-t border-surface-container-high/40 flex items-center justify-between text-[10px]");
  const left = el("div", "flex items-center gap-2 min-w-0");
  const statements = (gaps ?? 0) + (findings ?? 0);
  if (statements > 0) {
    const pill = el("span", "px-1.5 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-mono font-medium flex items-center gap-1 shrink-0");
    pill.appendChild(el("span", "w-1 h-1 rounded-full bg-tertiary"));
    pill.appendChild(el("span", "", `${statements} evidence statement${statements === 1 ? "" : "s"}`));
    pill.title = `${gaps ?? 0} gap statement(s), ${findings ?? 0} finding statement(s)`;
    left.appendChild(pill);
  } else {
    left.appendChild(el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline/70 font-mono shrink-0", "no evidence statements"));
  }
  const sourcePill = el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline/70 font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  sourcePill.appendChild(el("span", "material-symbols-outlined text-[12px]", "bolt"));
  if (id.sourceLabel === null) {
    sourcePill.appendChild(el("span", "", NOT_PUBLISHED));
    sourcePill.appendChild(el("span", "uppercase", `${id.sourceType} source identity`));
    sourcePill.title = `Not published: this ${id.sourceType} source carries no identity field`;
  } else {
    sourcePill.appendChild(el("span", "", id.sourceLabel));
    sourcePill.title = sourceLabelTitle(source, id.sourceLabel);
  }
  left.appendChild(sourcePill);
  foot.appendChild(left);

  const toggle = el("div", "flex items-center gap-1.5");
  const button = el("button", "toggle-switch w-6 h-3.5 rounded-full bg-surface-container-highest p-0.5 flex items-center opacity-50 cursor-not-allowed", undefined);
  button.type = "button";
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.dataset.active = "false";
  button.title = `${NOT_PUBLISHED}: no source-posture or allow-list contract`;
  button.appendChild(el("div", "w-2.5 h-2.5 rounded-full bg-outline"));
  toggle.appendChild(button);
  foot.appendChild(toggle);
  node.appendChild(foot);

  const select = () => selectEntry(id.entryId);
  node.addEventListener("click", (event) => {
    if (event.target.closest(".toggle-switch")) return;
    select();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  return node;
}

function renderCards() {
  const rows = visibleEntries();
  dom.cardsGrid.replaceChildren();
  if (!rows.length) {
    const empty = el("div", "p-4 rounded border border-surface-container-high/60 text-on-surface-variant text-[12px]", "No catalog entry matches this view. Published entries: ");
    empty.appendChild(el("span", "font-mono text-on-surface", String(state.entries.length)));
    dom.cardsGrid.appendChild(empty);
  } else {
    dom.cardsGrid.append(...rows.map(card));
  }
  dom.visibleCount.textContent = String(rows.length);
  dom.visibleCaption.textContent = `of ${state.entries.length} catalog entries`;
}

function computeCounts() {
  state.kindCounts = countBy((entry) => text(entry?.subject?.kind) ?? "unknown");
  state.sourceTypeCounts = countBy((entry) => entrySource(entry).type);
  dom.sourceIdentities = new Map();
  for (const entry of state.entries) {
    const source = entrySource(entry);
    if (!dom.sourceIdentities.has(source.type)) dom.sourceIdentities.set(source.type, new Map());
    const identities = dom.sourceIdentities.get(source.type);
    const label = sourceLabelOf(source) ?? NOT_PUBLISHED;
    if (!identities.has(label)) identities.set(label, { total: 0, revisions: new Map() });
    const group = identities.get(label);
    group.total += 1;
    const revision = source.revision ?? NOT_PUBLISHED;
    group.revisions.set(revision, (group.revisions.get(revision) ?? 0) + 1);
  }
}

function renderView() {
  computeCounts();
  renderLedger();
  renderRails();
  renderFilters();
  renderCards();
  renderInspector();
}

/* ------------------------------------------------------------------ inspector */

function paneReset() {
  dom.detailsIdentity.replaceChildren();
  dom.detailsSource.replaceChildren();
  dom.detailsCapabilities.replaceChildren();
  dom.detailsArtifacts.replaceChildren();
  dom.securityStatements.replaceChildren();
}

function renderInspector() {
  const entry = state.entries.find((candidate) => text(candidate?.entryId) === state.selectedId) ?? null;
  paneReset();
  if (!entry) {
    dom.inspectorName.textContent = "No entry selected";
    dom.inspectorKind.textContent = "-";
    dom.inspectorVersion.textContent = "-";
    dom.inspectorSubtitle.textContent = "Select a card to read its published identities and evidence";
    dom.inspectorFlags.textContent = NOT_PUBLISHED;
    dom.inspectorFlags.className = "font-mono text-outline font-semibold";
    dom.detailsDesc.textContent = NOT_PUBLISHED;
    row(dom.detailsIdentity, "Entry id", null);
    row(dom.detailsIdentity, "Subject id", null);
    field(dom.detailsCapabilities, "No entry selected", null);
    dom.detailsArtifacts.appendChild(el("div", "text-outline/70", NOT_PUBLISHED));
    dom.scannerReportStatement.textContent = NOT_PUBLISHED;
    dom.statementCount.textContent = "0 statements";
    return;
  }

  const id = identity(entry);
  const subject = entry.subject ?? {};
  const source = entrySource(entry);
  dom.inspectorName.textContent = id.entryId;
  dom.inspectorKind.textContent = id.kind;
  // The chip carries the locator of the source identity: repository+revision for github,
  // package version for npm, release for aih. It never shows an abbreviated digest as if it
  // were the whole revision, and it never turns a commit into a version.
  let locator = null;
  if (source.type === "github") locator = source.repository ?? source.commit;
  else if (source.type === "npm") locator = source.version;
  else if (source.type === "aih") locator = source.release;
  dom.inspectorVersion.textContent = locator ?? NOT_PUBLISHED;
  dom.inspectorVersion.title = locator === null
    ? `Not published: this ${source.type} source carries no locator field`
    : sourceLabelTitle(source, locator);
  dom.inspectorSubtitle.textContent = `${id.kind} · source ${id.sourceType}`;
  dom.inspectorIcon.textContent = KIND_ICON[id.kind] ?? "extension";

  const statements = statementsOf(entry);
  const findings = statements.filter((statement) => statement.kind === "finding").length;
  const gaps = statements.filter((statement) => statement.kind === "gap").length;
  if (findings + gaps === 0) {
    dom.inspectorFlags.textContent = "no evidence statements";
    dom.inspectorFlags.className = "font-mono text-on-surface-variant font-semibold";
  } else {
    dom.inspectorFlags.textContent = `${gaps} gap · ${findings} finding statement${findings === 1 ? "" : "s"}`;
    dom.inspectorFlags.className = "font-mono text-tertiary font-semibold";
  }

  row(dom.detailsIdentity, "Entry id", id.entryId);
  row(dom.detailsIdentity, "Subject id", subject.id);
  row(dom.detailsIdentity, "Subject kind", id.kind);
  row(dom.detailsIdentity, "Subject digest", subject.subjectDigest);
  row(dom.detailsIdentity, "Source digest", subject.sourceDigest);
  row(dom.detailsIdentity, "Platforms", Array.isArray(entry.platforms) && entry.platforms.length
    ? entry.platforms.map((platform) => `${text(platform?.os) ?? "?"}/${text(platform?.architecture) ?? "?"}`).join(", ")
    : null);

  // Source identity, in the shape that source type actually publishes.
  row(dom.detailsSource, "Source type", source.type);
  countRow(dom.detailsSource, "Entries from this source", dom.sourceIdentities.get(source.type)?.get(sourceLabelOf(source) ?? NOT_PUBLISHED)?.total ?? 0);
  for (const [label, value] of sourceDetailRows(source)) row(dom.detailsSource, label, value);
  // github and aih publish the whole revision in their own row above; npm publishes no commit,
  // so its integrity is the only revision there is, shortened and labelled as shortened.
  if (source.type === "npm" && source.revision !== null) {
    row(dom.detailsSource, "Revision", shortDigest(source.revision));
    row(dom.detailsSource, "Revision digest", "shortened for display; the integrity row above is the full value");
  }

  const summary = firstSummary(entry, ["gap", "finding", "right", "report"]);
  dom.detailsDesc.textContent = summary ?? NOT_PUBLISHED;

  const capabilities = entry.capabilities ?? {};
  const capabilityNames = Object.keys(capabilities);
  if (capabilityNames.length) {
    for (const capabilityName of capabilityNames) {
      const list = Array.isArray(capabilities[capabilityName]) ? capabilities[capabilityName] : null;
      field(dom.detailsCapabilities, capabilityName, list ? `${list.length} declared` : null, "checklist", "primary");
    }
  } else {
    field(dom.detailsCapabilities, "Declared capabilities", null, "checklist");
  }
  field(dom.detailsCapabilities, "Network egress", null, "wifi", "tertiary");
  field(dom.detailsCapabilities, "Execution sandbox", null, "terminal", "secondary");
  field(dom.detailsCapabilities, "Required secrets", null, "vpn_key", "outline");

  row(dom.detailsArtifacts, "Seed path", entry.seed?.path);
  row(dom.detailsArtifacts, "Seed sha256", entry.seed?.sha256);
  for (const [name, artifact] of Object.entries(entry.artifacts ?? {})) {
    row(dom.detailsArtifacts, `${name} path`, artifact?.path);
  }

  const report = statements.find((statement) => statement.kind === "report");
  dom.scannerReportStatement.textContent = report?.summary ?? NOT_PUBLISHED;
  dom.statementCount.textContent = `${statements.length} statements · envelope counts, not raw findings`;
  if (!statements.length) {
    dom.securityStatements.appendChild(el("div", "p-2 rounded bg-surface-container-low border border-surface-container-high/40 text-outline", "No evidence statement published for this entry"));
  }
  for (const statement of statements) {
    const box = el("div", "p-2 rounded bg-surface-container-low border border-surface-container-high/40 space-y-1");
    const head = el("div", "flex items-center justify-between gap-2");
    head.appendChild(el("span", "font-mono text-[10px] uppercase tracking-wider text-outline", statement.kind));
    head.appendChild(el("span", "font-mono text-[10px] text-on-surface break-all text-right", statement.id ?? NOT_PUBLISHED));
    box.appendChild(head);
    box.appendChild(el("p", "text-[10.5px] text-on-surface-variant leading-snug", statement.summary ?? NOT_PUBLISHED));
    const meta = el("div", "font-mono text-[9.5px] text-outline space-y-0.5");
    row(meta, "attestor", statement.attestor);
    row(meta, "format", statement.format);
    row(meta, "sha256", statement.sha256);
    row(meta, "path", statement.path);
    box.appendChild(meta);
    dom.securityStatements.appendChild(box);
  }
}

function selectEntry(entryId) {
  state.selectedId = entryId;
  if (dom.inspectorRail.classList.contains("w-0")) toggleInspector();
  renderCards();
  renderInspector();
  const entry = state.entries.find((candidate) => text(candidate?.entryId) === entryId) ?? null;
  void governanceSelect(entry);
}

function switchTab(tab) {
  for (const button of dom.tabButtons) {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(active));
    button.classList.toggle("bg-surface-container", active);
    button.classList.toggle("text-primary", active);
    button.classList.toggle("font-semibold", active);
    button.classList.toggle("shadow-xs", active);
    button.classList.toggle("text-on-surface-variant", !active);
  }
  dom.paneDetails.classList.toggle("hidden", tab !== "details");
  dom.paneSecurity.classList.toggle("hidden", tab !== "security");
  dom.paneGovernance.classList.toggle("hidden", tab !== "governance");
  dom.paneJson.classList.toggle("hidden", tab !== "json");
}

function toggleNav() {
  const collapsed = dom.navRail.classList.toggle("w-0");
  dom.navRail.classList.toggle("w-60", !collapsed);
  dom.navRail.classList.toggle("border-r-0", collapsed);
  dom.toggleNavBtn.classList.toggle("text-primary", !collapsed);
  dom.toggleNavBtn.classList.toggle("text-on-surface-variant", collapsed);
}

function toggleInspector() {
  const collapsed = dom.inspectorRail.classList.toggle("w-0");
  dom.inspectorRail.classList.toggle("w-[390px]", !collapsed);
  dom.inspectorRail.classList.toggle("border-l-0", collapsed);
  dom.toggleInspectorBtn.classList.toggle("text-primary", !collapsed);
  dom.toggleInspectorBtn.classList.toggle("text-on-surface-variant", collapsed);
}

/* ----------------------------------------------------------------------- boot */

function fail(message) {
  if (dom.error) {
    dom.error.textContent = message;
    dom.error.classList.remove("hidden");
  }
  console.error(`catalog: ${message}`);
}

function collectDom() {
  const ids = [
    "provenance-strip", "toggle-nav-btn", "toggle-inspector-btn", "nav-rail", "nav-sources-count",
    "rail-package-version", "rail-package-count", "rail-kind-list", "rail-source-list",
    "framework-matrix-tabs", "masthead-version", "masthead-facts", "kind-filters",
    "visible-count", "visible-caption", "cards-grid", "inspector-rail",
    "inspector-name", "inspector-kind", "inspector-version", "inspector-subtitle", "inspector-flags",
    "inspector-icon", "close-inspector-btn", "pane-details", "pane-security", "pane-json",
    "details-identity", "details-source", "details-desc", "details-capabilities", "details-artifacts",
    "scanner-report-statement", "statement-count", "security-statements", "catalog-error",
    "pane-governance",
  ];
  for (const id of ids) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`page is missing #${id}`);
    dom[id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = node;
  }
  dom.tabButtons = [...document.querySelectorAll(".inspector-tab-btn")];
  dom.search = document.getElementById("catalog-search");
  dom.sourceFilter = document.getElementById("source-filter");
  dom.sortSelect = document.getElementById("sort-select");
  // The governance pane owns its own elements and its own Core calls. This page
  // hands it the selection and nothing else.
  collectGovernanceDom();
}

function mastheadFacts() {
  const facts = dom.mastheadFacts;
  facts.replaceChildren();
  const summary = state.summary ?? {};
  const pkg = summary.package ?? {};
  facts.appendChild(chip("index", `${text(summary.format) ?? NOT_PUBLISHED} v${text(summary.version) ?? NOT_PUBLISHED}`));
  facts.appendChild(chip("entries", String(state.entries.length)));
  facts.appendChild(chip("kinds", String(state.kindCounts.size)));
  facts.appendChild(chip("source types", String(state.sourceTypeCounts.size)));
  facts.appendChild(chip("tarball sha256", text(pkg.tarballSha256)?.slice(0, 16) ?? NOT_PUBLISHED, "text-secondary"));
  const admission = el("span", "px-2 py-0.5 rounded bg-surface-container border border-surface-container-high/40 text-on-surface-variant flex items-center gap-1.5 text-[10.5px]", undefined);
  admission.appendChild(el("span", "text-outline uppercase", "organization admission"));
  admission.appendChild(el("span", `font-semibold ${summary.organizationAdmission === "not-authoritative" ? "text-tertiary" : "text-on-surface"}`, text(summary.organizationAdmission) ?? NOT_PUBLISHED));
  facts.appendChild(admission);
  facts.appendChild(chip("scope", NOT_SUPPLIED));
  facts.appendChild(chip("pinned", NOT_CONNECTED));
}

/* Local presentation tweaks kept out of the shared prototype stylesheets: the header swap for the
   dark-mode icon, and the Material Symbols axis so the icons match the prototype's rendering. */
function presentationCss() {
  const style = document.createElement("style");
  style.textContent = [
    ".material-symbols-outlined{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;}",
    "html.dark .icon-dark-mode{display:block;}html.light .icon-dark-mode{display:none;}",
  ].join("");
  document.head.appendChild(style);
}

/* ------------------------------------------------ published view state (session) */

const SAVED_KEY = "aih-ui-sources-view";
const SORT_KEYS = ["entryId", "entryId-desc", "kind", "sourceType", "sourceLabel", "release"];

function saveView() {
  try {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify(state.view));
  } catch {
    /* a blocked storage must never break the page */
  }
}

function restoreView() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(SAVED_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") return;
  if (typeof saved.query === "string") state.view.query = saved.query;
  // A view saved by an earlier build can name a sort key or a source this build does not
  // publish. Drop those instead of leaving a control and the grid disagreeing.
  if (typeof saved.kind === "string" && state.kindCounts.has(saved.kind)) state.view.kind = saved.kind;
  if (typeof saved.sourceType === "string" && state.sourceTypeCounts.has(saved.sourceType)) state.view.sourceType = saved.sourceType;
  if (typeof saved.source === "string") {
    const sourceType = saved.source.split(FILTER_SEPARATOR)[0];
    if (state.sourceTypeCounts.has(sourceType)) state.view.source = saved.source;
  }
  if (SORT_KEYS.includes(saved.sort)) state.view.sort = saved.sort;
}

async function loadJson(url, what) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error(`${what} could not be fetched from ${url}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`${what} could not be fetched from ${url}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${what} at ${url} is not JSON: ${error.message}`);
  }
}

/* Every render starts from the contract, not from whatever the file happens to hold. */
function assertIndexContract(index) {
  if (index?.format !== EXPECTED_FORMAT) {
    throw new Error(`catalog format is ${JSON.stringify(index?.format)} but ${EXPECTED_FORMAT} is required`);
  }
  if (index?.version !== EXPECTED_VERSION) {
    throw new Error(`catalog version is ${JSON.stringify(index?.version)} but ${EXPECTED_VERSION} is required`);
  }
  if (!Array.isArray(index.entries)) throw new Error("catalog index has no entries array");
}

function wireEvents() {
  dom.search.addEventListener("input", () => {
    state.view.query = dom.search.value;
    saveView();
    renderView();
  });
  dom.sourceFilter.addEventListener("change", () => {
    state.view.sourceType = dom.sourceFilter.value || null;
    state.view.source = null;
    saveView();
    renderView();
  });
  dom.sortSelect.addEventListener("change", () => {
    state.view.sort = dom.sortSelect.value;
    saveView();
    renderView();
  });
  dom.toggleNavBtn.addEventListener("click", toggleNav);
  dom.toggleInspectorBtn.addEventListener("click", toggleInspector);
  dom.closeInspectorBtn.addEventListener("click", toggleInspector);
  for (const button of dom.tabButtons) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") switchTab("details");
  });
}

async function main() {
  collectDom();
  presentationCss();
  let index;
  let summary = null;
  try {
    index = await loadJson(INDEX_URL, "the @aihq/catalog index");
    assertIndexContract(index);
    summary = await loadJson(SUMMARY_URL, "the preview summary").catch(() => null);
  } catch (error) {
    fail(error.message);
    return;
  }
  state.entries = index.entries;
  state.summary = summary;
  restoreView();
  dom.search.value = state.view.query;
  wireEvents();
  computeCounts();
  mastheadFacts();
  renderProvenance();
  dom.mastheadVersion.textContent = text(summary?.package?.version) ?? NOT_PUBLISHED;
  renderView();
}

main().catch((error) => fail(error?.stack ?? String(error)));
