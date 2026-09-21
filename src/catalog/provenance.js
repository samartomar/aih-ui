/*
 * What this page is reading: the masthead facts and the provenance strip.
 *
 * The strip stays one compact line - the package and how many entries it
 * carries. Package hashes, commits and the index's own package block are real
 * provenance but they are diagnostic detail, and inlining them pushed the strip
 * past the width the design source gives it, so they open in place instead.
 *
 * Every value is published verbatim and never summarised into a claim.
 */

import { el, text } from "../app/dom.js";
import { NOT_CONNECTED, NOT_PUBLISHED, NOT_SUPPLIED } from "../app/absence.js";
import { describeScope, sourceScopes } from "./selectors.js";

function chip(label, value, tone) {
  const node = el("span", "px-2 py-0.5 rounded bg-surface-container border border-surface-container-high/40 text-on-surface-variant flex items-center gap-1.5 text-[10.5px]");
  node.appendChild(el("span", "text-outline uppercase", label));
  node.appendChild(el("span", `font-semibold ${tone ?? "text-on-surface"}`, value));
  return node;
}

/**
 * @param elements { provenanceStrip, mastheadFacts, mastheadName, mastheadVersion }
 *
 * The masthead names the SELECTED SOURCE and its revision, as the design
 * source's masthead names its framework. With no source selected it says it is
 * showing every published source. The package that transports them is named in
 * the provenance strip above, not here.
 */
export function createProvenance({ elements }) {
  function renderStrip(model) {
    const strip = elements.provenanceStrip;
    strip.replaceChildren();
    const summary = model.summary ?? {};
    const pkg = summary.package ?? {};
    const indexPkg = summary.indexPackage ?? {};

    const lead = el("span", "shrink-0");
    lead.appendChild(el("span", "material-symbols-outlined text-[14px] text-primary align-middle", "account_tree"));
    strip.appendChild(lead);

    const fact = (label, value, tone) => {
      const span = el("span", "shrink-0");
      span.appendChild(el("span", "text-on-surface font-medium", `${label} `));
      span.appendChild(el("span", tone ?? "text-outline/80", value));
      strip.appendChild(span);
    };
    fact("@aihq/catalog", text(pkg.version) ?? NOT_PUBLISHED);
    fact("entries", String(model.total));
    strip.appendChild(el("span", "px-1.5 py-0.2 rounded bg-surface-container text-outline font-mono text-[10px] shrink-0", "read-only-mirror"));

    const details = el("details", "relative shrink-0");
    const summaryNode = el("summary", "cursor-pointer list-none px-1.5 py-0.2 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-[10px] select-none", "provenance");
    summaryNode.title = "Package hashes, commits and index metadata";
    details.appendChild(summaryNode);

    const panel = el("div", "absolute left-0 top-[18px] z-40 w-[440px] max-w-[90vw] p-2 rounded bg-surface-container-lowest border border-surface-container-high/60 shadow-2xl space-y-1 text-[10px] font-mono");
    const line = (label, value, tone) => {
      const node = el("div", "flex items-start justify-between gap-2");
      node.appendChild(el("span", "text-outline shrink-0", label));
      node.appendChild(el("span", `text-right break-all ${tone ?? "text-on-surface-variant"}`, value));
      panel.appendChild(node);
    };
    line("index format", `${text(summary.format) ?? NOT_PUBLISHED} v${text(summary.version) ?? NOT_PUBLISHED}`);
    line("index sha256", text(summary.indexSha256) ?? NOT_PUBLISHED);
    line("organization admission", text(summary.organizationAdmission) ?? NOT_PUBLISHED, "text-tertiary");
    // A package packed on this machine, not a registry release. Say which.
    line("provenance", "locally packed package", "text-secondary");
    for (const installed of summary.packages ?? []) {
      panel.appendChild(el("div", "pt-1 mt-1 border-t border-surface-container-high/40 text-on-surface font-semibold", `@aihq/${installed.name}`));
      line("tarball", text(installed.tarball) ?? NOT_PUBLISHED);
      line("sha256", text(installed.sha256) ?? NOT_PUBLISHED, "text-secondary");
      line("commit", text(installed.commit) ?? NOT_PUBLISHED);
      line("built from", text(installed.source) ?? NOT_PUBLISHED, "text-outline");
    }
    if (indexPkg?.version && pkg?.version && indexPkg.version !== pkg.version) {
      panel.appendChild(el("div", "pt-1 mt-1 border-t border-surface-container-high/40 text-tertiary", "the index names a different package version than the one installed"));
      line("index package", `${text(indexPkg.name) ?? NOT_PUBLISHED} ${indexPkg.version}`, "text-tertiary");
    }
    details.appendChild(panel);
    strip.appendChild(details);
  }

  function renderMasthead(model) {
    const scope = model.scope === null ? null : describeScope(model.scope);
    const sources = sourceScopes(model.counts).length;
    elements.mastheadName.textContent = scope === null ? "All published sources" : scope.name;
    elements.mastheadName.title = scope === null
      ? `Every source the installed index publishes (${sources})`
      : `Source identity published by the index: ${scope.name}`;
    // The version slot holds a revision, a version or a release - whichever the
    // selected source actually publishes - and never a stand-in for one.
    elements.mastheadVersion.textContent = scope === null ? `${sources} sources` : scope.badge ?? NOT_PUBLISHED;
    elements.mastheadVersion.title = scope === null ? "Number of published source identities" : scope.badgeTitle ?? NOT_PUBLISHED;
  }

  function renderFacts(model) {
    const facts = elements.mastheadFacts;
    facts.replaceChildren();
    const summary = model.summary ?? {};
    // One line, as the design source has it. Hashes and commits are diagnostic
    // and live in the provenance disclosure; repeating one here only cost a row.
    facts.appendChild(chip("items", String(model.scopeTotal)));
    if (model.scope !== null) {
      const scope = describeScope(model.scope);
      const label = model.scope.type === "github" ? "commit" : model.scope.type === "npm" ? "version" : "release";
      // The short form, as the design source's masthead shows it. The full
      // published value is on the tooltip and in the inspector's provenance.
      const revision = chip(label, scope.badge ?? NOT_PUBLISHED);
      revision.title = scope.revision === null ? NOT_PUBLISHED : `${label} ${scope.revision}`;
      facts.appendChild(revision);
    } else {
      facts.appendChild(chip("sources", String(sourceScopes(model.counts).length)));
    }
    facts.appendChild(chip("kinds", String(model.counts.kindCounts.size)));
    const admission = el("span", "px-2 py-0.5 rounded bg-surface-container border border-surface-container-high/40 text-on-surface-variant flex items-center gap-1.5 text-[10.5px]", undefined);
    admission.appendChild(el("span", "text-outline uppercase", "admission"));
    admission.appendChild(el("span", `font-semibold ${summary.organizationAdmission === "not-authoritative" ? "text-tertiary" : "text-on-surface"}`, text(summary.organizationAdmission) ?? NOT_PUBLISHED));
    facts.appendChild(admission);
    facts.appendChild(chip("scope", NOT_SUPPLIED));
    facts.appendChild(chip("pinned", NOT_CONNECTED));
  }

  return {
    /** @param model { summary, total, scopeTotal, scope, counts } */
    render(model) {
      renderMasthead(model);
      renderFacts(model);
      renderStrip(model);
    },
  };
}
