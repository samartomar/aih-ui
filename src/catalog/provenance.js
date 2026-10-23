/*
 * What this page is reading: the package strip, the masthead and the source
 * status line.
 *
 * The strip is the design source's compact line: the three packages this
 * preview actually installed, each with the version npm recorded installing
 * and, because these are local packages that can share a released version
 * number, its short checkpoint. Hashes, full commits, the index's own package
 * block and raw entry counts are diagnostic detail and open in place behind
 * "provenance".
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

const PACKAGE_ORDER = ["@aihq/core", "@aihq/scan", "@aihq/catalog"];
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/* The design source's separators: the package strip uses a bullet, the
   source status line a middle dot. */
const STRIP_SEPARATOR = "•";
const STATUS_SEPARATOR = "·";

function dot(separator = STATUS_SEPARATOR) {
  return el("span", "text-outline", separator);
}

/* The start-up contract check, worded as the Workbench reads contract words it.
   Only a Core without `checkContracts` has wording today; it is information, once,
   in the strip, and blocks nothing. */
export const CONTRACT_CHECK_ABSENT = "This Core can't check contracts yet.";

export function contractCheckNote(contractCheck) {
  if (contractCheck?.state !== "absent") return null;
  const note = el("span", "px-1.5 py-0.2 rounded bg-info-bg text-info font-mono text-[10px] shrink-0 inline-flex items-center gap-1");
  note.id = "contract-check-note";
  note.setAttribute("role", "note");
  note.appendChild(iconSpan("state", "info", { size: "text-[12px]" }));
  note.appendChild(el("span", "", CONTRACT_CHECK_ABSENT));
  attachTooltip(note, `${CONTRACT_CHECK_ABSENT} The installed @aihq/core publishes no checkContracts, so the Workbench cannot ask whether each package can read the contracts the others write. Nothing is blocked; everything keeps working as before.`);
  return note;
}

export function createProvenance({ elements }) {
  function packagesInOrder(summary) {
    const installed = new Map(
      (summary.packages ?? []).map((pkg) => [text(pkg?.packageName) ?? `@aihq/${text(pkg?.name)}`, pkg]),
    );
    return PACKAGE_ORDER.map((name) => ({ name, pkg: installed.get(name) ?? null }));
  }

  function renderStrip(model) {
    const strip = elements.provenanceStrip;
    strip.replaceChildren();
    const summary = model.summary ?? {};

    strip.appendChild(el("span", "material-symbols-outlined text-[14px] text-primary shrink-0", "account_tree"));
    packagesInOrder(summary).forEach(({ name, pkg }, position) => {
      if (position > 0) strip.appendChild(dot(STRIP_SEPARATOR));
      const group = el("span", "flex items-center gap-1 shrink-0");
      const label = el("span", "text-on-surface font-medium", `${name} `);
      const version = text(pkg?.version);
      label.appendChild(el("span", "text-outline", version ?? NOT_PUBLISHED));
      label.title = version === null
        ? `${name}: no installed version was recorded`
        : `${name} ${version}, as npm recorded installing it in this preview`;
      group.appendChild(label);
      const commit = text(pkg?.commit);
      if (commit !== null && /^[0-9a-f]{7,40}$/.test(commit)) {
        const chip = el("span", "px-1.5 py-0.5 rounded bg-surface-container-high/80 text-metadata-revision font-mono text-[10px]", commit.slice(0, 7));
        chip.title = `Local package packed from checkpoint ${commit}. Not a registry release.`;
        group.appendChild(chip);
      }
      strip.appendChild(group);
    });
    strip.appendChild(el("span", "px-1.5 py-0.2 rounded bg-surface-container text-outline font-mono text-[10px] shrink-0", "read-only-mirror"));
    const contractNote = contractCheckNote(summary.contractCheck);
    if (contractNote) strip.appendChild(contractNote);
    strip.appendChild(diagnostics(model));
  }

  /** Everything diagnostic, behind one disclosure. */
  function diagnostics(model) {
    const summary = model.summary ?? {};
    const indexPkg = summary.indexPackage ?? {};
    const details = el("details", "relative shrink-0");
    const summaryNode = el("summary", "cursor-pointer list-none px-1.5 py-0.2 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-[10px] select-none", "provenance");
    summaryNode.title = "Package hashes, commits and index metadata";
    details.appendChild(summaryNode);

    const panel = el("div", "absolute left-0 top-[18px] z-40 w-[460px] max-w-[90vw] max-h-[70vh] overflow-y-auto p-2 rounded bg-surface-container-lowest border border-wb-border shadow-panel space-y-1 text-[10px] font-mono select-text");
    const line = (label, value, tone) => {
      const node = el("div", "flex items-start justify-between gap-2");
      node.appendChild(el("span", "text-outline shrink-0", label));
      node.appendChild(el("span", `text-right break-all ${tone ?? "text-on-surface-variant"}`, value));
      panel.appendChild(node);
    };
    const heading = (value) =>
      panel.appendChild(el("div", "pt-1 mt-1 border-t border-wb-border text-on-surface font-medium", value));

    line("index format", `${text(summary.format) ?? NOT_PUBLISHED} v${text(summary.version) ?? NOT_PUBLISHED}`);
    line("index sha256", text(summary.indexSha256) ?? NOT_PUBLISHED);
    line("index entries", String(summary.entryCount ?? NOT_PUBLISHED));
    line("current inventory", String(model.total));
    line("organization admission", text(summary.organizationAdmission) ?? NOT_PUBLISHED, "text-tertiary");

    heading("Core targets");
    const targets = summary.coreTargets ?? {};
    line(
      "supported AI clients",
      targets.state === "published"
        ? `${targets.targets.length} from ${targets.source}`
        : `${NOT_PUBLISHED}: ${text(targets.reason) ?? "no target list"}`,
    );
    const check = summary.contractCheck ?? {};
    line(
      "contract check",
      check.state === "absent" ? CONTRACT_CHECK_ABSENT
        : check.state === "available" ? `checkContracts published by ${text(check.entry) ?? "@aihq/core"}; not run by this Workbench yet`
        : `Not checked: ${text(check.reason) ?? "this host did not inspect it"}`,
    );

    // A package packed on this machine, not a registry release. Say which.
    for (const { name, pkg } of packagesInOrder(summary)) {
      heading(name);
      if (pkg === null) {
        line("installed", NOT_PUBLISHED, "text-outline");
        continue;
      }
      line("version", text(pkg.version) ?? NOT_PUBLISHED);
      line("tarball", text(pkg.tarball) ?? NOT_PUBLISHED);
      line("sha256", text(pkg.sha256) ?? NOT_PUBLISHED, "text-metadata-revision");
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
    elements.mastheadName.title = scope === null
      ? `Every current source the installed index publishes (${sources})`
      : `Source identity published by Catalog: ${scope.name}`;
    // A revision, a version or a content release - whichever the selected
    // source actually publishes - and never a stand-in for one.
    elements.mastheadVersion.textContent = scope === null ? `${sources} sources` : scope.badge ?? NOT_PUBLISHED;
    elements.mastheadVersion.title = scope === null ? "Number of current published sources" : scope.badgeTitle ?? NOT_PUBLISHED;
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
    enabled.title = `Whether this source is enabled is organization and Core state. ${NOT_CONNECTED}: nothing supplies it yet.`;
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
    /** @param model { summary, total, scopeTotal, scope, counts } */
    render(model) {
      renderMasthead(model);
      renderStatus(model);
      renderStrip(model);
    },
  };
}
