/*
 * Sources & Catalogs, wired to the installed @aihq/catalog index.
 *
 * This module owns presentation and view state only. Every displayed value comes from
 * catalog-index.json or summary.json, both produced by tools/preview.mjs from the installed
 * package. Catalog strings are inserted with textContent; nothing from the catalog is parsed
 * as HTML. Where the prototype showed a field the index does not publish, the layout is kept,
 * the page says "Not published", and the control is disabled.
 */

const NOT_PUBLISHED = "Not published";
const INDEX_URL = "./catalog-index.json";
const SUMMARY_URL = "./summary.json";
const EXPECTED_FORMAT = "aih-catalog-index";
const EXPECTED_VERSION = 1;
const DISTINCT_REVISIONS = "__distinct__";

const IDENTITY_KEYS = ["entryId", "subjectId", "kind", "sourceType", "release", "revision"];

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

const KIND_ICON = { skill: "extension", agent: "smart_toy", mcp: "dns", package: "deployed_code", profile: "badge" };

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

function revisionOf(entry) {
  return text(entry?.subject?.source?.revision);
}

function sourceTypeOf(entry) {
  return text(entry?.subject?.source?.type) ?? "unknown";
}

/* A published release string may carry the pack name after '@'. Split only on what is there. */
function releaseLabelOf(entry) {
  const release = text(entry?.subject?.source?.release);
  if (release === null) return NOT_PUBLISHED;
  const at = release.lastIndexOf("@");
  return at > 0 && at < release.length - 1 ? release.slice(at + 1) : release;
}

function identity(entry) {
  return {
    entryId: text(entry?.entryId) ?? "(entryId not published)",
    subjectId: text(entry?.subject?.id) ?? NOT_PUBLISHED,
    kind: text(entry?.subject?.kind) ?? "unknown",
    sourceType: sourceTypeOf(entry),
    release: releaseLabelOf(entry),
    revision: revisionOf(entry) ?? NOT_PUBLISHED,
  };
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

function identityText(entry) {
  const id = identity(entry);
  return [id.entryId, id.subjectId, id.kind, id.sourceType, id.release, id.revision].join(" ");
}

/* ---------------------------------------------------------------------- view */

function visibleEntries() {
  const query = state.view.query.trim().toLocaleLowerCase();
  let rows = state.entries.filter((entry) => {
    const id = identity(entry);
    if (state.view.kind && id.kind !== state.view.kind) return false;
    if (state.view.sourceType && id.sourceType !== state.view.sourceType) return false;
    if (state.view.source) {
      const [type, release] = state.view.source.split("\u0000");
      if (id.sourceType !== type) return false;
      if (release !== DISTINCT_REVISIONS && id.release !== release) return false;
    }
    if (query && !identityText(entry).toLocaleLowerCase().includes(query)) return false;
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
  head.appendChild(el("span", "text-[10px] font-mono tabular-nums shrink-0 text-outline", count === null ? "Not published" : `${count}`));
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
    const releases = dom.sourceReleases.get(sourceType) ?? new Map();
    const expanded = state.view.sourceType === sourceType || (state.view.source?.startsWith(`${sourceType}\u0000`) ?? false);
    const panel = el("div", "rounded bg-surface-container-low/60 border border-surface-container-high/40 p-1 space-y-0.5");
    panel.appendChild(railRow(sourceType, count, {
      active: state.view.sourceType === sourceType,
      onClick: () => {
        state.view.sourceType = state.view.sourceType === sourceType ? null : sourceType;
        state.view.source = null;
        renderView();
      },
    }));
    // Publications appear only for the expanded source type: the index carries one row per
    // published identity, so a flat list here would just repeat the card grid.
    if (expanded) {
      const nested = el("div", "pl-2 space-y-0.5");
      for (const [release, releaseCount] of sortedCounts(releases)) {
        const value = `${sourceType}\u0000${release}`;
        nested.appendChild(railRow(release, releaseCount, {
          active: state.view.source === value,
          onClick: () => {
            state.view.source = state.view.source === value ? null : value;
            state.view.sourceType = null;
            renderView();
          },
        }));
      }
      panel.appendChild(nested);
    } else {
      panel.appendChild(el("div", "pl-2 px-1.5 py-0.5 font-mono text-[10px] text-outline", `${releases.size} release labels present`));
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
  const egress = el("span", "px-1.5 py-0.5 rounded bg-surface-container-low border border-surface-container-high/40 text-outline/70 font-mono hidden sm:inline-flex items-center gap-1 shrink-0");
  egress.appendChild(el("span", "material-symbols-outlined text-[12px]", "bolt"));
  egress.appendChild(el("span", "", id.release));
  egress.title = `Source release: ${id.release}`;
  left.appendChild(egress);
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
  state.kindCounts = countBy((entry) => identity(entry).kind);
  state.sourceTypeCounts = countBy((entry) => identity(entry).sourceType);
  dom.sourceReleases = new Map();
  for (const entry of state.entries) {
    const id = identity(entry);
    if (!dom.sourceReleases.has(id.sourceType)) dom.sourceReleases.set(id.sourceType, new Map());
    const releases = dom.sourceReleases.get(id.sourceType);
    releases.set(id.release, (releases.get(id.release) ?? 0) + 1);
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
  dom.detailsCapabilities.replaceChildren();
  dom.detailsArtifacts.replaceChildren();
  dom.securityStatements.replaceChildren();
}

function renderInspector() {
  const entry = state.entries.find((candidate) => identity(candidate).entryId === state.selectedId) ?? null;
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
  const source = subject.source ?? {};
  dom.inspectorName.textContent = id.entryId;
  dom.inspectorKind.textContent = id.kind;
  dom.inspectorVersion.textContent = id.release;
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
  row(dom.detailsIdentity, "Source type", id.sourceType);
  row(dom.detailsIdentity, "Source release", id.release);
  row(dom.detailsIdentity, "Source revision", revisionOf(entry));
  row(dom.detailsIdentity, "Subject digest", subject.subjectDigest);
  row(dom.detailsIdentity, "Source digest", subject.sourceDigest);
  row(dom.detailsIdentity, "Platforms", Array.isArray(entry.platforms) && entry.platforms.length
    ? entry.platforms.map((platform) => `${text(platform?.os) ?? "?"}/${text(platform?.architecture) ?? "?"}`).join(", ")
    : null);

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
    "details-identity", "details-desc", "details-capabilities", "details-artifacts",
    "scanner-report-statement", "statement-count", "security-statements", "catalog-error",
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
  facts.appendChild(chip("scope", NOT_PUBLISHED));
  facts.appendChild(chip("pinned", NOT_PUBLISHED));
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
  if (typeof saved.kind === "string" || saved.kind === null) state.view.kind = saved.kind;
  if (typeof saved.sourceType === "string" || saved.sourceType === null) state.view.sourceType = saved.sourceType;
  if (typeof saved.source === "string" || saved.source === null) state.view.source = saved.source;
  if (["entryId", "entryId-desc", "kind", "sourceType", "release"].includes(saved.sort)) state.view.sort = saved.sort;
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

