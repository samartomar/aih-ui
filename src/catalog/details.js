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
 * The compact header identifies the item and its kind. Source fields appear
 * once in Upstream Provenance; evidence summaries appear once in Security's
 * evidence statements, exactly as Catalog's public reader returns them.
 *
 * The Security tab's Qualification block shows Catalog's publisher
 * qualification for the entry - the reader's state word, the receipt window,
 * the signed head's signature state and the attestation state - with the same
 * footer under every state: publisher qualification is not organizational
 * authorization. A qualified state is Catalog's word, never an approval.
 */

import { el, text } from "../app/dom.js";
import {
  EVIDENCE_SUMMARY_ABSENT,
  FINDING_DETAIL_ABSENT,
  NOT_DECLARED,
  NOT_PUBLISHED,
  QUALIFICATION_IS_NOT_AUTHORIZATION,
} from "../app/absence.js";
import { KIND_ICON, KIND_TONE, identity, sourceDetailRows, sourceIdentity, statementsOf } from "./entry.js";
import { collectionOf, scopeCountOf } from "./selectors.js";
import { provenanceNote, publishedText, publisherOf } from "./publisher.js";
import { QUALIFICATION_STATE_MEANING, attestationSentence, qualificationOf } from "./qualification.js";

/* These Catalog inspector slots have no verified per-entry scan input. Scan
 * 0.5.0's typed finding reader is used in Governance after operator verification;
 * Catalog still cannot populate this slot from its index alone. */
const DETECTOR_RUN_STATE_ABSENT =
  `${NOT_PUBLISHED}: Scan publishes one detector per record and no per-detector run state.`;
/** An entry the installed Catalog's qualification sidecar does not name. */
const QUALIFICATION_NOT_COVERED =
  `${NOT_PUBLISHED}: the installed Catalog's qualification sidecar does not cover this entry.`;

function row(parent, label, value, title, code = false) {
  const present = text(value) !== null;
  const line = el("div", `inspector-row ${code && present ? "inspector-row-code" : ""}`);
  line.appendChild(el("span", "shrink-0", label));
  const shown = text(value) ?? NOT_PUBLISHED;
  const valueNode = el(code && present ? "code" : "span", code && present ? "inspector-code-value" : shown === NOT_PUBLISHED ? "text-outline" : "text-on-surface", shown);
  if (title) valueNode.title = title;
  line.appendChild(valueNode);
  parent.appendChild(line);
  return line;
}

function codeRow(parent, label, value, title) { return row(parent, label, value, title, true); }

/* A row whose value is a count of entries rather than a package field: the page computed it,
   so an empty list reads as zero and never borrows the "Not published" wording. */
function countRow(parent, label, value) {
  const line = el("div", "inspector-row");
  line.appendChild(el("span", "shrink-0", label));
  line.appendChild(el("span", "text-on-surface text-right break-all", String(value)));
  parent.appendChild(line);
  return line;
}

/** One capability row in the design source's own layout. */
function capability(container, label, icon, tone, value, title) {
  const toneClass = { tertiary: "text-tertiary", secondary: "text-secondary", outline: "text-outline" }[tone];
  const line = el("div", "p-2 rounded bg-surface-container-low border border-wb-border flex items-center justify-between gap-2");
  const left = el("div", "flex items-center gap-1.5 text-on-surface");
  const glyph = el("span", `material-symbols-outlined text-[14px] ${toneClass}`, icon);
  glyph.setAttribute("aria-hidden", "true");
  left.appendChild(glyph);
  left.appendChild(el("span", "", label));
  line.appendChild(left);
  const known = value !== NOT_PUBLISHED && value !== NOT_DECLARED;
  const valueNode = el("span", `font-mono text-[10px] text-right ${known ? toneClass : "text-outline"}`, value);
  if (title) valueNode.title = title;
  line.appendChild(valueNode);
  container.appendChild(line);
}

/** The capability list the index declares, or "Not declared" when it is empty. */
function declared(list) {
  return Array.isArray(list) && list.length > 0 ? list.join(", ") : NOT_DECLARED;
}

/** A "label value" line of the Qualification block; the value is the reader's word, as text. */
function qualificationLine(parent, label, value, title, key) {
  const line = el("div", "inspector-row");
  line.appendChild(el("span", "shrink-0 font-mono text-outline", label));
  const valueNode = el("span", "font-mono text-on-surface text-right break-all", value);
  valueNode.dataset.qualification = key;
  if (title) valueNode.title = title;
  line.appendChild(valueNode);
  parent.appendChild(line);
}

/**
 * The Qualification block for one entry, or its reason when there is none.
 * Nothing here is coloured as success: `qualified` is Catalog's statement
 * about its own signed catalog, not a decision anyone made about this item.
 */
function renderQualification(elements, view, entry) {
  const box = elements.securityQualification;
  box.replaceChildren();
  const sidecar = view?.state === "published" ? view.document : null;
  elements.qualificationEvaluated.textContent = sidecar === null ? "-" : `evaluated ${sidecar.evaluatedAt}`;
  elements.qualificationEvaluated.title = sidecar === null
    ? ""
    : `Catalog's qualification reader evaluated every receipt at ${sidecar.evaluatedAt}, when this preview started.`;
  const reason = entry === null
    ? "No entry is selected, so there is no qualification to state."
    : sidecar === null
      ? view?.reason ?? `${NOT_PUBLISHED}: the preview supplied no qualification.`
      : qualificationOf(view, entry) === null
        ? QUALIFICATION_NOT_COVERED
        : null;
  if (reason !== null) {
    box.className = "p-2 rounded bg-surface-container-low border border-wb-border space-y-1 text-[10.5px] text-outline";
    box.dataset.absence = "qualification";
    box.textContent = NOT_PUBLISHED;
    box.title = reason;
    return;
  }
  delete box.dataset.absence;
  box.title = "";
  box.className = "p-2 rounded bg-surface-container-low border border-wb-border space-y-1 text-[10.5px] text-on-surface-variant";
  const record = qualificationOf(view, entry);
  qualificationLine(
    box, "state", record.state,
    `${record.state}: ${QUALIFICATION_STATE_MEANING[record.state] ?? "a state this build has no wording for"}, ` +
      `at ${sidecar.evaluatedAt}. ${QUALIFICATION_IS_NOT_AUTHORIZATION}`,
    "state",
  );
  qualificationLine(box, "notBefore", record.notBefore, "The receipt's validity window opens at this instant.", "notBefore");
  qualificationLine(box, "expiresAt", record.expiresAt, "The receipt's validity window closes at this instant.", "expiresAt");
  qualificationLine(
    box, "signature", sidecar.signature,
    `The shipped signed catalog head (sequence ${sidecar.catalog?.sequence}, signed by ${sidecar.catalog?.signerIdentity}), ` +
      "re-verified against the shipped public signer root by Catalog's reader.",
    "signature",
  );
  qualificationLine(
    box, "attestation", sidecar.attestation,
    `The outer attestation over the receipts, for ${sidecar.publisher?.repository}.`,
    "attestation",
  );
  const sentence = el("p", "text-[10px] text-outline leading-snug break-words", attestationSentence(sidecar));
  sentence.dataset.qualification = "attestation-sentence";
  box.appendChild(sentence);
}

/** @param elements the inspector header and the two panes' containers */
export function createDetails({ elements }) {
  // Two Scanner Telemetry slots the design source fills from a scan result.
  // Neither depends on the selection, so each states its reason once, here.
  elements.detectorRunState.title = DETECTOR_RUN_STATE_ABSENT;
  elements.detectorFindingDetail.title = `${NOT_PUBLISHED}: ${FINDING_DETAIL_ABSENT}`;
  elements.qualificationFooter.textContent = QUALIFICATION_IS_NOT_AUTHORIZATION;

  function reset() {
    elements.detailsIdentity.replaceChildren();
    elements.detailsSource.replaceChildren();
    elements.detailsCapabilities.replaceChildren();
    elements.detailsArtifacts.replaceChildren();
    elements.securityStatements.replaceChildren();
  }

  function renderEmpty() {
    elements.inspectorName.textContent = "";
    elements.inspectorName.title = "";
    elements.inspectorKind.removeAttribute("aria-label");
    delete elements.inspectorKind.dataset.label;
    elements.detailsDesc.textContent = NOT_PUBLISHED;
    capability(elements.detailsCapabilities, "Network Egress", "wifi", "tertiary", NOT_PUBLISHED);
    capability(elements.detailsCapabilities, "Execution Sandbox", "terminal", "secondary", NOT_PUBLISHED);
    capability(elements.detailsCapabilities, "Required Secrets", "vpn_key", "outline", NOT_PUBLISHED);
    row(elements.detailsSource, "Origin", null);
    row(elements.detailsIdentity, "Entry id", null);
    elements.detailsArtifacts.appendChild(el("div", "text-outline", NOT_PUBLISHED));
    elements.statementCount.textContent = "0 statements";
  }

  function renderStatements(statements) {
    if (!statements.length) {
      elements.securityStatements.appendChild(el("div", "p-2 rounded bg-surface-container-low border border-wb-border text-outline", "No evidence statement published for this entry"));
    }
    for (const statement of statements) {
      const box = el("div", "p-2 rounded bg-surface-container-low border border-wb-border space-y-1");
      const head = el("div", "flex items-center justify-between gap-2");
      head.appendChild(el("span", "font-mono text-[10px] uppercase tracking-wider text-outline", statement.kind));
      head.appendChild(el("span", "font-mono text-[10px] text-on-surface break-all text-right", statement.id ?? NOT_PUBLISHED));
      box.appendChild(head);
      // The summary as Catalog's public reader returned it, verbatim and as
      // text. A reader that does not return one (an older Catalog) leaves no
      // summary in the served document, and the slot says which package owns
      // that gap rather than sitting empty.
      const prose = el("p", "inspector-prose text-[11px] text-on-surface-variant", statement.summary ?? NOT_PUBLISHED);
      if (statement.summary === null || statement.summary === undefined) prose.title = EVIDENCE_SUMMARY_ABSENT;
      box.appendChild(prose);
      const meta = el("div", "font-mono text-[9.5px] text-outline space-y-0.5");
      row(meta, "attestor", statement.attestor);
      row(meta, "format", statement.format);
      codeRow(meta, "sha256", statement.sha256);
      codeRow(meta, "path", statement.path);
      box.appendChild(meta);
      elements.securityStatements.appendChild(box);
    }
  }

  return {
    /** @param model { entry, counts, publisher, qualification } */
    render({ entry, counts, publisher, qualification }) {
      reset();
      renderQualification(elements, qualification, entry ?? null);
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
      elements.inspectorKind.setAttribute("aria-label", `Kind: ${id.kind}`);
      elements.inspectorKind.dataset.label = `Kind: ${id.kind}`;
      elements.inspectorIcon.textContent = KIND_ICON[id.kind] ?? "extension";
      elements.inspectorIcon.className = `material-symbols-outlined text-[15px] ${KIND_TONE[id.kind] ?? "text-outline"}`;

      // --------------------------------------------- Publisher Overview
      // Upstream text, set as text: never markup, never an instruction.
      elements.detailsDesc.textContent = description ?? NOT_PUBLISHED;
      elements.detailsDesc.className = description === null
        ? "text-outline leading-relaxed text-[11px]"
        : "inspector-prose text-on-surface-variant text-[11px]";
      elements.detailsDesc.title = provenanceNote(record, "description", "Publisher description", publisher);

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
      // Full source values live here, without an abbreviated second copy.
      for (const [label, value] of sourceDetailRows(source)) codeRow(elements.detailsSource, label, value);
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
      codeRow(elements.detailsIdentity, "Entry id", id.entryId);
      codeRow(elements.detailsIdentity, "Subject id", subject.id);
      row(elements.detailsIdentity, "Subject kind", id.kind);
      codeRow(elements.detailsIdentity, "Subject digest", subject.subjectDigest);
      codeRow(elements.detailsIdentity, "Source digest", subject.sourceDigest);
      row(elements.detailsIdentity, "Source type", source.type);
      row(elements.detailsIdentity, "Platforms", Array.isArray(entry.platforms) && entry.platforms.length
        ? entry.platforms.map((platform) => `${text(platform?.os) ?? "?"}/${text(platform?.architecture) ?? "?"}`).join(", ")
        : null);

      // Where the publisher text came from, so every value can be traced.
      if (record?.source) {
        codeRow(elements.detailsArtifacts, "Publisher text file", record.source.path);
        codeRow(elements.detailsArtifacts, "Publisher text sha256", record.source.sha256);
      } else {
        row(elements.detailsArtifacts, "Publisher text file", null, provenanceNote(record, "description", "Publisher text", publisher));
      }
      // What the upstream publisher declares, kept apart from Catalog's
      // curated category on the card badge.
      row(
        elements.detailsArtifacts, "Upstream category", publishedText(record, "category"),
        provenanceNote(record, "category", "Upstream category", publisher),
      );
      codeRow(elements.detailsArtifacts, "Seed path", entry.seed?.path);
      codeRow(elements.detailsArtifacts, "Seed sha256", entry.seed?.sha256);
      for (const [name, artifact] of Object.entries(entry.artifacts ?? {})) {
        codeRow(elements.detailsArtifacts, `${name} path`, artifact?.path);
      }

      // ----------------------------------------------------------- Security
      const statements = statementsOf(entry);
      elements.statementCount.textContent = `${statements.length} statements · envelope counts, not raw findings`;
      renderStatements(statements);
    },
  };
}
