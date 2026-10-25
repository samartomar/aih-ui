/*
 * The inspector's Details and Security tabs.
 *
 * Details keeps the design source's order and meaning:
 *
 *   Overview               the item's description
 *   Declared Capabilities  network egress, execution sandbox, required secrets
 *   Upstream Provenance    origin, pinned commit (or version / release), license
 *
 * then one disclosure holding the exact identifiers, long digests and artifact
 * references - available, but not leading the pane.
 *
 * What the index does not carry says so in its own slot:
 *   - a description the release does not carry, and sandbox, secrets and
 *     license: "Not published";
 *   - capabilities it DOES carry, as empty lists: "Not declared". An empty
 *     declaration is not a measurement, so it is never shown as "none".
 *
 * The compact header identifies the item and its kind. Source fields appear
 * once in Upstream Provenance; evidence summaries appear once in Security's
 * evidence statements, exactly as Catalog's public reader returns them.
 */

import { createGapIndicator } from '../app/gap-indicator.js';
import { createInspectorEvidence } from '../app/inspector-evidence.js';
import { el, text } from "../app/dom.js";
import { capabilityFacts } from './authoring-model.js';
import { sourcePresentation } from './source-facts.js';
import { describeClientIdentity } from '../app/client-identity.js';
import {
  EVIDENCE_SUMMARY_ABSENT,
  FINDING_DETAIL_ABSENT,
  NOT_DECLARED,
  NOT_PUBLISHED,
} from "../app/absence.js";
import { identity, sourceDetailRows, sourceIdentity, statementsOf } from "./entry.js";
import { iconFor } from "../app/icons.js";
import { scopeCountOf } from "./selectors.js";

/* These Catalog inspector slots have no verified per-entry scan input. */
const DETECTOR_RUN_STATE_ABSENT =
  'No verified Scan artifact is connected to this legacy statement mirror. Inspect acquired assessments through Scan Review.';

function row(parent, label, value, title, code = false) {
  const present = text(value) !== null;
  const line = el("div", `inspector-row ${code && present ? "inspector-row-code" : ""}`);
  line.appendChild(el("span", "shrink-0", label));
  const shown = text(value) ?? NOT_PUBLISHED;
  const valueNode = el(code && present ? "code" : "span", code && present ? "inspector-code-value" : shown === NOT_PUBLISHED ? "text-outline" : "text-on-surface", shown);
  if (title) valueNode.title = title;
  line.appendChild(present ? valueNode : createGapIndicator({ label: NOT_PUBLISHED, reason: title ?? `${label} is not published for this entry.` }));
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
  line.appendChild(known ? valueNode : createGapIndicator({ label: value, reason: title ?? `${label} is ${value.toLowerCase()} for this entry.` }));
  container.appendChild(line);
}

/** The capability list the index declares, or "Not declared" when it is empty. */
function declared(list) {
  return Array.isArray(list) && list.length > 0 ? list.join(", ") : NOT_DECLARED;
}

/** @param elements the inspector header and the two panes' containers */
export function createDetails({ elements, authoring, subscribeSecurity }) {
  const evidence = createInspectorEvidence({ authoring, subscribeSecurity });
  elements.detectorRunState.after(evidence.panel);
  // Two Scanner Telemetry slots the design source fills from a scan result.
  // Neither depends on the selection, so each states its reason once, here.
  elements.detectorRunState.title = DETECTOR_RUN_STATE_ABSENT;
  elements.detectorFindingDetail.title = `${NOT_PUBLISHED}: ${FINDING_DETAIL_ABSENT}`;

  /** The header's kind icon and accent, from the shared icon map. */
  function showKindIcon(kind) {
    const shown = iconFor("kind", kind);
    elements.inspectorIcon.textContent = shown.icon;
    elements.inspectorIcon.className = `material-symbols-outlined text-[15px] ${shown.tone}`;
  }

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
    /**
     * @param model { entry, counts, target, coreClients } `target` is the AI client whose capability facts the
     *   page shows; `coreClients` is Core's nativeClientIds, or null when Core published none (client support is then unknown)
     */
    render({ entry, counts, target, coreClients }) {
      reset();
      evidence.show(entry?.authoringItem);
      elements.detectorRunState.title = DETECTOR_RUN_STATE_ABSENT;
      elements.detectorFindingDetail.title = `${NOT_PUBLISHED}: ${FINDING_DETAIL_ABSENT}`;
      const statementSection = elements.statementCount.parentElement?.parentElement;
      if (statementSection) statementSection.hidden = Boolean(entry?.authoringItem);
      if (!entry) {
        renderEmpty();
        return;
      }
      if (entry.authoringItem) {
        elements.detectorRunState.removeAttribute('title');
        elements.detectorFindingDetail.removeAttribute('title');
        const item = entry.authoringItem;
        const source = sourcePresentation(item);
        elements.inspectorName.textContent = source.name;
        elements.inspectorKind.setAttribute('aria-label', `Kind: ${item.kind}`);
        elements.inspectorKind.dataset.label = `Kind: ${item.kind}`;
        showKindIcon(item.kind);
        elements.detailsDesc.replaceChildren();
        if (source.description.length > 320) {
          elements.detailsDesc.append(el('span', '', `${source.description.slice(0, 300).trimEnd()}…`));
          const full = el('details', 'inspector-description-more');
          full.append(el('summary', '', 'Read full source description'), el('span', 'inspector-prose block', source.description));
          elements.detailsDesc.append(full);
        } else elements.detailsDesc.textContent = source.description;
        if (source.facts) {
          const facts = source.facts;
          row(elements.detailsSource, 'Source profile', `${facts.profile} · ${facts.status}`);
          codeRow(elements.detailsSource, 'Source identifier', facts.identifier);
          codeRow(elements.detailsSource, 'Source path', facts.provenance?.path);
          for (const key of ['name', 'description']) row(elements.detailsSource, `Source ${key}`, `${facts[key].state} · ${facts[key].locator}${facts[key].state === 'authored' ? '' : ` · ${facts[key].required ? 'required' : 'optional'}`}`);
          codeRow(elements.detailsSource, 'Source revision', facts.provenance?.revision);
          codeRow(elements.detailsSource, 'Source sha256', facts.provenance?.sha256);
          for (const diagnostic of facts.diagnostics ?? []) row(elements.detailsSource, diagnostic.field, diagnostic.message);
          const native = el('details');
          native.append(el('summary', 'cursor-pointer', 'Source declarations — separate from installation requirements'));
          if (facts.profile === 'claude-hooks') native.append(el('p', '', 'Hook events, matchers and handlers are declared operational facts. Reading them does not run them.'));
          if (facts.profile === 'claude-mcp-registration') native.append(el('p', '', 'MCP client registration only. Individual tool metadata and running server behavior are not established.'));
          if (facts.native?.environmentNames?.length || facts.native?.headerNames?.length) native.append(el('p', 'text-on-surface-variant', 'Environment and header values withheld from this view; declared names are retained.'));
          for (const redaction of facts.redactions ?? []) native.append(el('p', 'text-on-surface-variant', `Withheld: ${redaction.path} — ${redaction.reason}`));
          native.append(el('pre', 'whitespace-pre-wrap break-all text-[10px]', JSON.stringify(facts.native, null, 2)));
          elements.detailsSource.append(native);
          if (authoring) {
            const original = el('details');
            original.append(el('summary', 'cursor-pointer', 'Original source material (may contain sensitive values)'));
            const content = el('pre', 'whitespace-pre-wrap break-all text-[10px]');
            const load = el('button', 'px-2 py-1 border border-wb-border rounded', 'Read original source as text');
            load.type = 'button';
            load.addEventListener('click', async () => {
              load.disabled = true;
              try {
                const result = await authoring.request('source-material', { target: `${item.root.releaseSha256}/${item.id}`, policyBytes: undefined });
                content.textContent = result.status === 'read' ? result.text : 'Original source material unavailable in this page session.';
              } catch { content.textContent = 'Original source material could not be read.'; }
              finally { load.disabled = false; }
            });
            original.append(load, content); elements.detailsSource.append(original);
          }
        }
        row(elements.detailsSource, 'Content family', item.family);
        row(elements.detailsSource, 'Package', `${item.package.name}@${item.package.version}`);
        row(elements.detailsSource, 'Provenance', item.family === 'Personal' ? 'Local folder explicitly selected in this page session; no GitHub provenance inferred.' : 'Published installed release; upstream origins retained below.');
        for (const fact of capabilityFacts(item, target)) {
          const node = el('p', 'p-2 rounded border border-wb-border text-[11px]', `${fact.support} · ${fact.capability} · ${fact.surface} — ${fact.reason ?? 'No producer reason supplied.'}`);
          elements.detailsCapabilities.append(node);
        }
        // A client adapter's target, whether Core supports it and whether the client is installed are three separate facts.
        const clientFacts = describeClientIdentity({ item, coreClients });
        if (clientFacts) for (const fact of [clientFacts.target, clientFacts.core, clientFacts.installed]) elements.detailsCapabilities.append(el('p', 'p-2 rounded border border-wb-border text-[11px]', fact.text));
        row(elements.detailsIdentity, 'Item id', item.id);
        codeRow(elements.detailsIdentity, 'Release sha256', item.root.releaseSha256);
        codeRow(elements.detailsIdentity, 'Item sha256', item.root.itemSha256);
        const disclosure = el('pre', 'whitespace-pre-wrap break-all text-[10px]');
        disclosure.textContent = JSON.stringify({ origins: item.sources, inputs: item.inputs, dependencies: item.dependencies, recipe: item.recipe, materials: item.materials, targets: item.targets }, null, 2);
        elements.detailsArtifacts.append(disclosure);
        elements.detectorRunState.className = 'p-2 rounded bg-surface-container-low border border-wb-border flex flex-col items-start gap-2 text-[11px]';
        elements.detectorRunState.textContent = 'View item coverage here, or inspect full assessments in Scan Review.';
        const inspectEvidence = el('button', 'px-3 py-1.5 rounded border border-wb-border', 'Review baseline, latest and history');
        inspectEvidence.type = 'button';
        inspectEvidence.addEventListener('click', () => {
          document.getElementById('nav-scan-review').click();
          document.dispatchEvent(new CustomEvent('aih:scan-content', { detail: { target: `${item.root.releaseSha256}/${item.id}` } }));
        });
        elements.detectorRunState.append(inspectEvidence);
        elements.detectorFindingDetail.replaceChildren(el('span', '', 'Execution and guardrails'), createGapIndicator({ label: 'Not established', reason: 'Supported material formats do not establish native execution or automatic guardrails. Review evidence and use the policy execution workflow for supported checks.' }));
        return;
      }

      const id = identity(entry);
      const subject = entry.subject ?? {};
      const source = sourceIdentity(entry);


      // ------------------------------------------------------------ header
      elements.inspectorName.textContent = id.name;
      elements.inspectorName.title = id.entryId;
      elements.inspectorKind.setAttribute("aria-label", `Kind: ${id.kind}`);
      elements.inspectorKind.dataset.label = `Kind: ${id.kind}`;
      showKindIcon(id.kind);

      // --------------------------------------------------------- Overview
      elements.detailsDesc.textContent = NOT_PUBLISHED;
      elements.detailsDesc.className = "text-outline leading-relaxed text-[11px]";
      elements.detailsDesc.title = "The index carries no description for this entry.";

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
      countRow(elements.detailsSource, "Items from this source", scopeCountOf(entry, counts));

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
