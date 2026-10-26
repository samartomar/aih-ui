/*
 * What this page is reading: the package strip, the masthead and the source
 * status line.
 *
 * The Packages disclosure preserves the installed package versions, checkpoints,
 * mirror mode and truthful contract checks without crowding the task header.
 * Full versions, archive hashes and the index metadata are diagnostic detail
 * available by keyboard and touch in that disclosure.
 *
 * The masthead names the SELECTED SOURCE, as the design source's masthead names
 * its framework, and the status line under the Source Policy control carries
 * the same slots the design source gives it. Catalog supplies the source
 * identity and the commit it recorded. Whether the source is enabled, which
 * scope it applies to and whether an installation is pinned are organization
 * and Core state; none is connected, so those slots say so. A commit Catalog
 * recorded is never shown as this organization's pin.
 */

import { el, text } from "../app/dom.js";
import { NOT_CONNECTED, NOT_PUBLISHED, NOT_SUPPLIED } from "../app/absence.js";
import { describeScope, sourceScopes } from "./selectors.js";
import { iconSpan } from "../app/icons.js";
import { attachTooltip } from "../app/tooltip.js";
import { contractCheckNote, contractCheckView } from "../app/contract-check.js";

const PACKAGE_ORDER = ["@aihq/core", "@aihq/scan", "@aihq/catalog"];
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/* The design source's separators: the package strip uses a bullet, the
   source status line a middle dot. */
const STATUS_SEPARATOR = "·";

function dot(separator = STATUS_SEPARATOR) {
  return el("span", "text-outline", separator);
}

export function createProvenance({ elements }) {
  // The start-up contract check arrives on its own; until then it reads as loading.
  let contractCheck;
  let lastModel = null;
  function packagesInOrder(summary) {
    const installed = new Map(
      (summary.packages ?? []).map((pkg) => [text(pkg?.packageName) ?? `@aihq/${text(pkg?.name)}`, pkg]),
    );
    return PACKAGE_ORDER.map((name) => ({ name, pkg: installed.get(name) ?? null }));
  }

  function renderStrip(model) {
    const strip = elements.provenanceStrip;
    const previous = strip.querySelector('details');
    const wasOpen = previous?.open ?? false;
    const hadFocus = previous?.contains(document.activeElement) ?? false;
    const disclosure = diagnostics(model);
    disclosure.open = wasOpen;
    strip.replaceChildren(disclosure);
    if (hadFocus) disclosure.querySelector('summary').focus();
  }

  /** Everything diagnostic, behind one disclosure. */
  function diagnostics(model) {
    const summary = model.summary ?? {};
    const indexPkg = summary.indexPackage ?? {};
    const details = el("details", "package-disclosure relative shrink-0");
    details.id = "package-disclosure";
    const summaryNode = el("summary", "cursor-pointer list-none px-1.5 py-0.2 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-[10px] select-none", "Packages");
    const checkView = contractCheckView(contractCheck);
    attachTooltip(summaryNode, `Installed package versions, hashes and checkpoints. ${checkView.words}`);
    summaryNode.setAttribute('aria-label', `Packages. ${checkView.words}`);
    if (checkView.state !== 'passed') summaryNode.appendChild(iconSpan('state', 'info', { size: 'text-[12px]' }));
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape' && details.open) { event.stopPropagation(); details.open = false; summaryNode.focus(); }
    });
    details.appendChild(summaryNode);

    const panel = el("div", "package-panel absolute left-0 top-[18px] z-40 w-[460px] max-w-[90vw] max-h-[70vh] overflow-y-auto p-2 rounded bg-surface-container-lowest border border-wb-border shadow-panel space-y-1 text-[10px] font-mono select-text");
    const line = (label, value, tone) => {
      const node = el("div", "flex items-start justify-between gap-2");
      node.appendChild(el("span", "text-outline shrink-0", label));
      node.appendChild(el("span", `text-right break-all ${tone ?? "text-on-surface-variant"}`, value));
      panel.appendChild(node);
    };
    const heading = (value) =>
      panel.appendChild(el("div", "pt-1 mt-1 border-t border-wb-border text-on-surface font-medium", value));

    line("mode", "read-only-mirror");
    const contractNote = contractCheckNote(checkView);
    if (contractNote) panel.appendChild(contractNote);
    line("index format", `${text(summary.format) ?? NOT_PUBLISHED} v${text(summary.version) ?? NOT_PUBLISHED}`);
    line("index sha256", text(summary.indexSha256) ?? NOT_PUBLISHED);
    line("index entries", String(summary.entryCount ?? NOT_PUBLISHED));
    line("current inventory", String(model.total ?? NOT_PUBLISHED));
    line("organization admission", text(summary.organizationAdmission) ?? NOT_PUBLISHED, "text-tertiary");

    heading("Core targets");
    const targets = summary.coreTargets ?? {};
    line(
      "supported AI clients",
      targets.state === "published"
        ? `${targets.targets.length} from ${targets.source}`
        : `${NOT_PUBLISHED}: ${text(targets.reason) ?? "no target list"}`,
    );
    const check = contractCheckView(contractCheck);
    line("contract check", check.words);
    for (const detail of check.detail) line("", detail);

    // A package packed on this machine, not a registry release. Say which.
    for (const { name, pkg } of packagesInOrder(summary)) {
      heading(name);
      if (pkg === null) {
        line("installed", NOT_PUBLISHED, "text-outline");
        continue;
      }
      line("version", text(pkg.version) ?? NOT_PUBLISHED);
      line("tarball", text(pkg.tarball) ?? NOT_PUBLISHED);
      line("sha256", text(pkg.sha256) ?? NOT_PUBLISHED);
      line("commit", text(pkg.commit) ?? NOT_PUBLISHED);
      line("built from", text(pkg.source) ?? NOT_PUBLISHED, "text-outline");
    }
    const catalogVersion = packagesInOrder(summary).find(({ name }) => name === "@aihq/catalog")?.pkg?.version;
    if (indexPkg?.version && catalogVersion && indexPkg.version !== catalogVersion) {
      heading("the index names a different package version than the one installed");
      line("index package", `${text(indexPkg.name) ?? NOT_PUBLISHED} ${indexPkg.version}`, "text-tertiary");
    }
    details.appendChild(panel);
    return details;
  }

  function renderMasthead(model) {
    const scope = model.scope === null ? null : describeScope(model.scope);
    const sources = sourceScopes(model.counts).length;
    elements.mastheadName.textContent = scope === null ? "All published sources" : scope.name;
    attachTooltip(elements.mastheadName, scope === null
      ? `Every current source the installed index publishes (${sources})`
      : `Source identity published by Catalog: ${scope.name}`);
    // A revision, a version or a content release - whichever the selected
    // source actually publishes - and never a stand-in for one.
    elements.mastheadVersion.textContent = scope === null ? `${sources} sources` : scope.badge ?? NOT_PUBLISHED;
    attachTooltip(elements.mastheadVersion, scope === null ? "Number of current published sources" : scope.badgeTitle ?? NOT_PUBLISHED);
  }

  /** One fact of the status line: a muted label and its value. */
  function fact(label, value, title) {
    const node = el("span", "");
    if (label) node.appendChild(document.createTextNode(`${label} `));
    const absent = value === NOT_SUPPLIED || value === NOT_CONNECTED || value === NOT_PUBLISHED;
    node.appendChild(el("strong", absent ? "text-outline font-medium" : "text-on-surface font-medium", value));
    if (title) node.title = title;
    return node;
  }

  /** The source identity Catalog published, as a link when it is a GitHub repository. */
  function identityNode(model, scope) {
    const source = model.scope.source ?? {};
    if (model.scope.type === "github" && GITHUB_REPOSITORY.test(source.repository ?? "")) {
      const link = el("a", "text-primary hover:underline cursor-pointer", source.repository);
      link.href = `https://github.com/${source.repository}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `Repository recorded by Catalog: ${source.repository}`;
      return link;
    }
    const node = el("span", "text-primary", scope.owner ?? scope.name);
    node.title = "Source identity published by Catalog";
    return node;
  }

  /** What Catalog recorded for the source: a commit, a version or a content release. */
  function recordedNode(model, scope) {
    if (model.scope.type === "github") {
      return scope.revision === null
        ? fact("recorded", `${model.scope.revisionCount} commits`, "Items of this repository were recorded at more than one commit")
        : fact("recorded", scope.badge, `Commit ${scope.revision}, as Catalog recorded it. A recorded commit is not this organization's pin.`);
    }
    return fact(model.scope.type === "npm" ? "version" : "release", scope.badge ?? NOT_PUBLISHED, scope.badgeTitle ?? undefined);
  }

  function renderStatus(model) {
    const line = elements.mastheadStatus;
    line.replaceChildren();

    // The design source's ENABLED slot: organization / Core state, not Catalog's.
    const enabled = el("span", "px-2 py-0.5 rounded bg-surface-container border border-wb-border text-outline font-medium flex items-center gap-1.5 text-[10.5px]");
    enabled.appendChild(el("span", "w-1.5 h-1.5 rounded-full bg-outline"));
    enabled.appendChild(document.createTextNode(`ENABLED · ${NOT_CONNECTED}`));
    attachTooltip(enabled, `Whether this source is enabled is organization and Core state. ${NOT_CONNECTED}: nothing supplies it yet.`);
    line.appendChild(enabled);

    if (model.scope === null) {
      line.appendChild(dot());
      const indexed = Number.isInteger(model.summary?.entryCount) ? model.summary.entryCount : null;
      line.appendChild(fact(
        "Catalog inventory",
        indexed === null ? `${model.total} current` : `${model.total} current / ${indexed} indexed`,
        indexed === null
          ? "Entries of the Catalog releases this Workbench reads."
          : `Entries of the Catalog releases this Workbench reads, of ${indexed} the served summary counts.`,
      ));
    } else {
      const scope = describeScope(model.scope);
      line.appendChild(dot());
      line.appendChild(recordedNode(model, scope));
      line.appendChild(dot());
      line.appendChild(identityNode(model, scope));
    }
    line.appendChild(dot());
    line.appendChild(fact("scope", NOT_SUPPLIED, "Project or user scope is the organization's input. Not supplied."));
    line.appendChild(dot());
    line.appendChild(fact("pinned", NOT_CONNECTED, "An installation pin is Core state. Not connected; a commit Catalog recorded is not a pin."));
  }

  return {
    /** Package diagnostics are available even while the catalog itself is loading or unavailable. */
    setSummary(summary) {
      lastModel = { ...lastModel, summary };
      renderStrip(lastModel);
    },
    /** @param model { summary, total, scopeTotal, scope, counts } */
    render(model) {
      lastModel = model;
      renderMasthead(model);
      renderStatus(model);
      renderStrip(model);
    },
    /** The host's start-up contract-check answer; the strip and its detail re-render with it. */
    setContractCheck(answer) {
      contractCheck = answer;
      if (lastModel) renderStrip(lastModel);
    },
  };
}
