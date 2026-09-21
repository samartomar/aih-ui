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

function chip(label, value, tone) {
  const node = el("span", "px-2 py-0.5 rounded bg-surface-container border border-surface-container-high/40 text-on-surface-variant flex items-center gap-1.5 text-[10.5px]");
  node.appendChild(el("span", "text-outline uppercase", label));
  node.appendChild(el("span", `font-semibold ${tone ?? "text-on-surface"}`, value));
  return node;
}

/** @param elements { provenanceStrip, mastheadFacts, mastheadVersion } */
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

  function renderFacts(model) {
    const facts = elements.mastheadFacts;
    facts.replaceChildren();
    const summary = model.summary ?? {};
    // One line, as the design source has it. Hashes and commits are diagnostic
    // and live in the provenance disclosure; repeating one here only cost a row.
    facts.appendChild(chip("entries", String(model.total)));
    facts.appendChild(chip("kinds", String(model.counts.kindCounts.size)));
    facts.appendChild(chip("frameworks", String(model.counts.providerCounts.size)));
    facts.appendChild(chip("sources", String(model.counts.sourceTypeCounts.size)));
    const admission = el("span", "px-2 py-0.5 rounded bg-surface-container border border-surface-container-high/40 text-on-surface-variant flex items-center gap-1.5 text-[10.5px]", undefined);
    admission.appendChild(el("span", "text-outline uppercase", "admission"));
    admission.appendChild(el("span", `font-semibold ${summary.organizationAdmission === "not-authoritative" ? "text-tertiary" : "text-on-surface"}`, text(summary.organizationAdmission) ?? NOT_PUBLISHED));
    facts.appendChild(admission);
    facts.appendChild(chip("scope", NOT_SUPPLIED));
    facts.appendChild(chip("pinned", NOT_CONNECTED));
  }

  return {
    /** @param model { summary, total, counts } */
    render(model) {
      renderFacts(model);
      renderStrip(model);
      elements.mastheadVersion.textContent = text(model.summary?.package?.version) ?? NOT_PUBLISHED;
    },
  };
}
