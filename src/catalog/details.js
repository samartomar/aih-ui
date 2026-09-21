/*
 * The inspector's Details and Security tabs: the selected entry's published
 * identities, its source identity in the shape that source type publishes, and
 * its evidence statements.
 *
 * Every row is a published value or "Not published". The counts this pane shows
 * are counted here from the index, so an empty list reads as zero rather than
 * borrowing the wording for a field the package does not carry.
 */

import { el, text } from "../app/dom.js";
import { NOT_PUBLISHED } from "../app/absence.js";
import { KIND_ICON, firstSummary, identity, shortDigest, sourceDetailRows, sourceIdentity, sourceLabelOf, sourceLabelTitle, statementsOf } from "./entry.js";

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

/** @param elements the inspector header and the two panes' containers */
export function createDetails({ elements }) {
  function reset() {
    elements.detailsIdentity.replaceChildren();
    elements.detailsSource.replaceChildren();
    elements.detailsCapabilities.replaceChildren();
    elements.detailsArtifacts.replaceChildren();
    elements.securityStatements.replaceChildren();
  }

  function renderEmpty() {
    elements.inspectorName.textContent = "No entry selected";
    elements.inspectorKind.textContent = "-";
    elements.inspectorVersion.textContent = "-";
    elements.inspectorSubtitle.textContent = "Select a card to read its published identities and evidence";
    elements.inspectorFlags.textContent = NOT_PUBLISHED;
    elements.inspectorFlags.className = "font-mono text-outline font-semibold";
    elements.detailsDesc.textContent = NOT_PUBLISHED;
    row(elements.detailsIdentity, "Entry id", null);
    row(elements.detailsIdentity, "Subject id", null);
    field(elements.detailsCapabilities, "No entry selected", null);
    elements.detailsArtifacts.appendChild(el("div", "text-outline/70", NOT_PUBLISHED));
    elements.scannerReportStatement.textContent = NOT_PUBLISHED;
    elements.statementCount.textContent = "0 statements";
  }

  function renderStatements(statements) {
    if (!statements.length) {
      elements.securityStatements.appendChild(el("div", "p-2 rounded bg-surface-container-low border border-surface-container-high/40 text-outline", "No evidence statement published for this entry"));
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
      elements.securityStatements.appendChild(box);
    }
  }

  return {
    /** @param model { entry, sourceIdentities } */
    render({ entry, sourceIdentities }) {
      reset();
      if (!entry) {
        renderEmpty();
        return;
      }

      const id = identity(entry);
      const subject = entry.subject ?? {};
      const source = sourceIdentity(entry);
      elements.inspectorName.textContent = id.entryId;
      elements.inspectorKind.textContent = id.kind;
      // The chip carries the locator of the source identity: repository+revision for github,
      // package version for npm, release for aih. It never shows an abbreviated digest as if it
      // were the whole revision, and it never turns a commit into a version.
      let locator = null;
      if (source.type === "github") locator = source.repository ?? source.commit;
      else if (source.type === "npm") locator = source.version;
      else if (source.type === "aih") locator = source.release;
      elements.inspectorVersion.textContent = locator ?? NOT_PUBLISHED;
      elements.inspectorVersion.title = locator === null
        ? `Not published: this ${source.type} source carries no locator field`
        : sourceLabelTitle(source, locator);
      elements.inspectorSubtitle.textContent = `${id.kind} · source ${id.sourceType}`;
      elements.inspectorIcon.textContent = KIND_ICON[id.kind] ?? "extension";

      const statements = statementsOf(entry);
      const findings = statements.filter((statement) => statement.kind === "finding").length;
      const gaps = statements.filter((statement) => statement.kind === "gap").length;
      if (findings + gaps === 0) {
        elements.inspectorFlags.textContent = "no evidence statements";
        elements.inspectorFlags.className = "font-mono text-on-surface-variant font-semibold";
      } else {
        elements.inspectorFlags.textContent = `${gaps} gap · ${findings} finding statement${findings === 1 ? "" : "s"}`;
        elements.inspectorFlags.className = "font-mono text-tertiary font-semibold";
      }

      row(elements.detailsIdentity, "Entry id", id.entryId);
      row(elements.detailsIdentity, "Subject id", subject.id);
      row(elements.detailsIdentity, "Subject kind", id.kind);
      row(elements.detailsIdentity, "Subject digest", subject.subjectDigest);
      row(elements.detailsIdentity, "Source digest", subject.sourceDigest);
      row(elements.detailsIdentity, "Platforms", Array.isArray(entry.platforms) && entry.platforms.length
        ? entry.platforms.map((platform) => `${text(platform?.os) ?? "?"}/${text(platform?.architecture) ?? "?"}`).join(", ")
        : null);

      // Source identity, in the shape that source type actually publishes.
      row(elements.detailsSource, "Source type", source.type);
      countRow(elements.detailsSource, "Entries from this source", sourceIdentities.get(source.type)?.get(sourceLabelOf(source) ?? NOT_PUBLISHED)?.total ?? 0);
      for (const [label, value] of sourceDetailRows(source)) row(elements.detailsSource, label, value);
      // github and aih publish the whole revision in their own row above; npm publishes no commit,
      // so its integrity is the only revision there is, shortened and labelled as shortened.
      if (source.type === "npm" && source.revision !== null) {
        row(elements.detailsSource, "Revision", shortDigest(source.revision));
        row(elements.detailsSource, "Revision digest", "shortened for display; the integrity row above is the full value");
      }

      elements.detailsDesc.textContent = firstSummary(entry, ["gap", "finding", "right", "report"]) ?? NOT_PUBLISHED;

      const capabilities = entry.capabilities ?? {};
      const capabilityNames = Object.keys(capabilities);
      if (capabilityNames.length) {
        for (const capabilityName of capabilityNames) {
          const list = Array.isArray(capabilities[capabilityName]) ? capabilities[capabilityName] : null;
          field(elements.detailsCapabilities, capabilityName, list ? `${list.length} declared` : null, "checklist", "primary");
        }
      } else {
        field(elements.detailsCapabilities, "Declared capabilities", null, "checklist");
      }
      field(elements.detailsCapabilities, "Network egress", null, "wifi", "tertiary");
      field(elements.detailsCapabilities, "Execution sandbox", null, "terminal", "secondary");
      field(elements.detailsCapabilities, "Required secrets", null, "vpn_key", "outline");

      row(elements.detailsArtifacts, "Seed path", entry.seed?.path);
      row(elements.detailsArtifacts, "Seed sha256", entry.seed?.sha256);
      for (const [name, artifact] of Object.entries(entry.artifacts ?? {})) {
        row(elements.detailsArtifacts, `${name} path`, artifact?.path);
      }

      const report = statements.find((statement) => statement.kind === "report");
      elements.scannerReportStatement.textContent = report?.summary ?? NOT_PUBLISHED;
      elements.statementCount.textContent = `${statements.length} statements · envelope counts, not raw findings`;
      renderStatements(statements);
    },
  };
}
