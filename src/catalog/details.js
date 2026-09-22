/*
 * The inspector's Details and Security tabs.
 *
 * Details keeps the design source's order and meaning:
 *
 *   Publisher Overview     the publisher's description of the item
 *   Declared Capabilities  network egress, execution sandbox, required secrets
 *   Upstream Provenance    origin, pinned commit (or version / release), license
 *
 * then one disclosure holding the exact identifiers, long digests and artifact
 * references - available, but not leading the pane.
 *
 * What the index does not carry says so in its own slot:
 *   - the publisher description is Catalog's publisher metadata, verbatim;
 *     where Catalog publishes none, and for sandbox, secrets and license:
 *     "Not published";
 *   - capabilities it DOES carry, as empty lists: "Not declared". An empty
 *     declaration is not a measurement, so it is never shown as "none".
 *
 * The header's flags slot is where the design source reports scan flags. No
 * scan result is published per item, so it says so rather than showing a count
 * of the Catalog's own evidence statements in that place. Those statements are
 * on the Security tab, labelled as statements.
 */

import { el, text } from "../app/dom.js";
import { FINDING_DETAIL_ABSENT, NOT_DECLARED, NOT_PUBLISHED } from "../app/absence.js";
import { KIND_ICON, identity, shortDigest, sourceDetailRows, sourceIdentity, sourceLabelOf, statementsOf } from "./entry.js";
import { collectionOf, scopeCountOf } from "./selectors.js";
import { provenanceNote, publishedText, publisherOf } from "./publisher.js";

/*
 * Why each Scanner Telemetry slot is empty. Each names the package that owns
 * the missing field, so a reader can tell a gap in this page from a gap in a
 * package. When Scan publishes them, these lookups are what change - the slots
 * and their geometry stay as they are.
 */
const DETECTOR_RUN_STATE_ABSENT =
  `${NOT_PUBLISHED}: Scan publishes one detector per record and no per-detector run state.`;
const EVIDENCE_SUMMARY_ABSENT =
  `${NOT_PUBLISHED}: Catalog's public reader does not surface the evidence summary.`;

function row(parent, label, value, title) {
  const line = el("div", "flex justify-between gap-2");
  line.appendChild(el("span", "shrink-0", label));
  const shown = text(value) ?? NOT_PUBLISHED;
  const valueNode = el("span", shown === NOT_PUBLISHED ? "text-outline/70 text-right" : "text-on-surface text-right break-all", shown);
  if (title) valueNode.title = title;
  line.appendChild(valueNode);
  parent.appendChild(line);
  return line;
}

/* A row whose value is a count of entries rather than a package field: the page computed it,
   so an empty list reads as zero and never borrows the "Not published" wording. */
function countRow(parent, label, value) {
  const line = el("div", "flex justify-between gap-2");
  line.appendChild(el("span", "shrink-0", label));
  line.appendChild(el("span", "text-on-surface text-right break-all", String(value)));
  parent.appendChild(line);
  return line;
}

/** One capability row in the design source's own layout. */
function capability(container, label, icon, tone, value, title) {
  const line = el("div", "p-2 rounded bg-surface-container-low border border-surface-container-high/30 flex items-center justify-between gap-2");
  const left = el("div", "flex items-center gap-1.5 text-on-surface");
  left.appendChild(el("span", `material-symbols-outlined text-[14px] text-${tone}`, icon));
  left.appendChild(el("span", "", label));
  line.appendChild(left);
  const known = value !== NOT_PUBLISHED && value !== NOT_DECLARED;
  const valueNode = el("span", `font-mono text-[10px] text-right ${known ? `text-${tone}` : "text-outline/70"}`, value);
  if (title) valueNode.title = title;
  line.appendChild(valueNode);
  container.appendChild(line);
}

/** The capability list the index declares, or "Not declared" when it is empty. */
function declared(list) {
  return Array.isArray(list) && list.length > 0 ? list.join(", ") : NOT_DECLARED;
}

/** The version / release slot of the header: only ever a real version or release. */
function versionOf(source) {
  if (source.type === "npm") return source.version;
  if (source.type === "aih") return source.release;
  // A github source publishes a commit, not a release. A commit is shown in
  // Upstream Provenance and is never passed off as a version.
  return null;
}

/** The origin line of Upstream Provenance, from published fields only. */
function originOf(source) {
  if (source.type === "github") return source.repository;
  if (source.type === "npm") {
    return source.packageName === null ? null : `${source.registry ? `${source.registry} ` : ""}${source.packageName}`.trim();
  }
  if (source.type === "aih") return source.release === null ? null : `aih release ${source.release}`;
  return sourceLabelOf(source);
}

/** @param elements the inspector header and the two panes' containers */
export function createDetails({ elements }) {
  // Two Scanner Telemetry slots the design source fills from a scan result.
  // Neither depends on the selection, so each states its reason once, here.
  elements.detectorRunState.title = DETECTOR_RUN_STATE_ABSENT;
  elements.detectorFindingDetail.title = `${NOT_PUBLISHED}: ${FINDING_DETAIL_ABSENT}`;

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
    capability(elements.detailsCapabilities, "Network Egress", "wifi", "tertiary", NOT_PUBLISHED);
    capability(elements.detailsCapabilities, "Execution Sandbox", "terminal", "secondary", NOT_PUBLISHED);
    capability(elements.detailsCapabilities, "Required Secrets", "vpn_key", "outline", NOT_PUBLISHED);
    row(elements.detailsSource, "Origin", null);
    row(elements.detailsIdentity, "Entry id", null);
    elements.detailsArtifacts.appendChild(el("div", "text-outline/70", NOT_PUBLISHED));
    elements.scannerReportStatement.textContent = NOT_PUBLISHED;
    // Nothing is selected yet, so this slot is not Catalog's gap. Say which.
    elements.scannerReportStatement.title = "No entry is selected, so there is no evidence record to summarise.";
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
      // The served index carries a summary on every evidence record today, and
      // it is rendered verbatim. Catalog's PUBLIC reader validates that same
      // field and then drops it, so a record that reaches this page without one
      // states which package owns the gap rather than sitting empty.
      const prose = el("p", "text-[10.5px] text-on-surface-variant leading-snug break-words", statement.summary ?? NOT_PUBLISHED);
      if (statement.summary === null || statement.summary === undefined) prose.title = EVIDENCE_SUMMARY_ABSENT;
      box.appendChild(prose);
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
    /** @param model { entry, counts, publisher } */
    render({ entry, counts, publisher }) {
      reset();
      if (!entry) {
        renderEmpty();
        return;
      }

      const id = identity(entry);
      const subject = entry.subject ?? {};
      const source = sourceIdentity(entry);

      const record = publisherOf(publisher, entry);
      const description = publishedText(record, "description");

      // ------------------------------------------------------------ header
      elements.inspectorName.textContent = publishedText(record, "title") ?? id.name;
      elements.inspectorName.title = id.entryId;
      elements.inspectorKind.textContent = id.kind;
      const version = versionOf(source);
      elements.inspectorVersion.textContent = version ?? NOT_PUBLISHED;
      elements.inspectorVersion.title = version === null
        ? `Version: ${NOT_PUBLISHED}. This ${source.type} source publishes no release label.`
        : `${source.type === "aih" ? "Release" : "Version"} ${version}`;
      elements.inspectorSubtitle.textContent = `${id.kind} · ${originOf(source) ?? source.type}`;
      elements.inspectorIcon.textContent = KIND_ICON[id.kind] ?? "extension";
      elements.inspectorFlags.textContent = NOT_PUBLISHED;
      elements.inspectorFlags.className = "font-mono text-outline font-semibold";
      elements.inspectorFlags.title = "Scan flags: not published. No scan result is published for this item.";

      // --------------------------------------------- Publisher Overview
      // Upstream text, set as text: never markup, never an instruction.
      elements.detailsDesc.textContent = description ?? NOT_PUBLISHED;
      elements.detailsDesc.className = description === null
        ? "text-outline/70 leading-relaxed text-[11px]"
        : "text-on-surface-variant leading-relaxed text-[11px] whitespace-pre-line break-words";
      elements.detailsDesc.title = provenanceNote(record, "description", "Publisher description");

      // ---------------------------------------------- Declared Capabilities
      const capabilities = entry.capabilities ?? {};
      const emptyNote =
        "The index declares an empty list. A declaration is not a measurement: " +
        "it does not show that there is none.";
      const egress = declared(capabilities.egress);
      capability(
        elements.detailsCapabilities, "Network Egress", "wifi", "tertiary", egress,
        egress === NOT_DECLARED ? emptyNote : "Declared by the index",
      );
      capability(
        elements.detailsCapabilities, "Execution Sandbox", "terminal", "secondary", NOT_PUBLISHED,
        "The index carries no execution sandbox field.",
      );
      capability(
        elements.detailsCapabilities, "Required Secrets", "vpn_key", "outline", NOT_PUBLISHED,
        "The index carries no required-secrets field.",
      );

      // ------------------------------------------------ Upstream Provenance
      row(elements.detailsSource, "Origin", originOf(source));
      if (source.type === "github") {
        row(elements.detailsSource, "Pinned Commit", source.commit === null ? null : source.commit.slice(0, 12), source.commit ?? undefined);
        row(elements.detailsSource, "Path", source.path);
      } else if (source.type === "npm") {
        row(elements.detailsSource, "Version", source.version);
        row(elements.detailsSource, "Integrity", shortDigest(source.integrity), source.integrity ?? undefined);
      } else if (source.type === "aih") {
        row(elements.detailsSource, "Content revision", shortDigest(source.revision), source.revision ?? undefined);
      }
      row(elements.detailsSource, "License", null, "The index carries no license field.");
      const collection = collectionOf(entry, counts);
      if (collection !== null) {
        // Catalog's statement that this entry is current content of a
        // collection - not an installation, and not the running version.
        row(
          elements.detailsSource,
          "Collection",
          `${collection.owner.package} ${collection.current.release}`,
          `Catalog collection ${collection.id}: current content release ${collection.current.release}, owned by ${collection.owner.package}`,
        );
      }
      countRow(
        elements.detailsSource,
        collection === null ? "Items from this source" : "Items in this collection",
        scopeCountOf(entry, counts),
      );

      // --------------------------- identity and artifacts, behind disclosure
      row(elements.detailsIdentity, "Entry id", id.entryId);
      row(elements.detailsIdentity, "Subject id", subject.id);
      row(elements.detailsIdentity, "Subject kind", id.kind);
      row(elements.detailsIdentity, "Subject digest", subject.subjectDigest);
      row(elements.detailsIdentity, "Source digest", subject.sourceDigest);
      row(elements.detailsIdentity, "Source type", source.type);
      // Every published source field in full, in the order that type publishes them.
      for (const [label, value] of sourceDetailRows(source)) row(elements.detailsIdentity, label, value);
      row(elements.detailsIdentity, "Platforms", Array.isArray(entry.platforms) && entry.platforms.length
        ? entry.platforms.map((platform) => `${text(platform?.os) ?? "?"}/${text(platform?.architecture) ?? "?"}`).join(", ")
        : null);

      // Where the publisher text came from, so every value can be traced.
      if (record?.source) {
        row(elements.detailsArtifacts, "Publisher text file", record.source.path);
        row(elements.detailsArtifacts, "Publisher text sha256", record.source.sha256);
      } else {
        row(elements.detailsArtifacts, "Publisher text file", null, provenanceNote(record, "description", "Publisher text"));
      }
      row(elements.detailsArtifacts, "Seed path", entry.seed?.path);
      row(elements.detailsArtifacts, "Seed sha256", entry.seed?.sha256);
      for (const [name, artifact] of Object.entries(entry.artifacts ?? {})) {
        row(elements.detailsArtifacts, `${name} path`, artifact?.path);
      }

      // ----------------------------------------------------------- Security
      const statements = statementsOf(entry);
      const report = statements.find((statement) => statement.kind === "report");
      const reportSummary = text(report?.summary);
      elements.scannerReportStatement.textContent = reportSummary ?? NOT_PUBLISHED;
      elements.scannerReportStatement.title = reportSummary === null
        ? EVIDENCE_SUMMARY_ABSENT
        : "The evidence record's own summary, as Catalog published it.";
      elements.statementCount.textContent = `${statements.length} statements · envelope counts, not raw findings`;
      renderStatements(statements);
    },
  };
}
