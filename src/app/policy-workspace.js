/* Role-specific presentation only. Saved setup is not policy authority. */
import { collectIds } from "./dom.js";

const COPY = {
  vibe: {
    role: "Vibe Coder · Project policy",
    title: "Your project policy",
    intro: "This space is for a policy saved separately for each project or AI CLI. The CLI applies the finished file.",
    startTitle: "Project starting point",
    start: "Start an empty project policy or open a saved project policy. Choose installed or personal content in Sources & Catalogs.",
    choices: "Review your explicit choices and their pinned dependencies. Configuration and removal are proposed changes that require acceptance.",
    review: "Catalog validates composition and Core validates the policy. Review proposed changes, accept them, then save the actual policy artifact.",
  },
  admin: {
    role: "Enterprise Admin · Organization policy",
    title: "Organization policy",
    intro: "Prepare a policy in a local organization workspace. You handle Git commit and push after saving the finished file.",
    startTitle: "Organization starting point",
    start: "Project authoring is available below. Saving a project policy establishes no organization approval.",
    choices: "Edit local project choices below. Organization Required, Optional and Blocked controls need a current operator-supplied organization authority context.",
    review: "Review and save the composed project policy artifact. Organization signing, approval and Git publication require your separate operator workflow.",
  },
  developer: {
    role: "Enterprise Developer · Project policy",
    title: "Project policy under your organization",
    intro: "Open the policy supplied by your admin, then save a separate policy for your project. The organization policy stays read-only.",
    startTitle: "Organization policy and project start",
    start: "Start or open a project policy below. The organization policy your admin publishes is read by the configured execution host, not opened here.",
    choices: "Project choices below are portable authoring. Organization narrowing requires current operator-supplied authority; saved setup and imported structure do not verify approval.",
    review: "Review and save the composed project policy below. A configured execution host independently checks current organization authority before applying.",
  },
};

export function createPolicyWorkspace() {
  const elements = collectIds([
    "policy-workspace-role", "policy-workspace-title", "policy-workspace-intro",
    "policy-start-title", "policy-start-description", "policy-choices-description",
    "policy-review-description",
  ]);
  return {
    setSettings(settings) {
      const role = settings.experience === "vibe" ? "vibe" : settings.role;
      const copy = COPY[role];
      if (!copy) throw new Error("Saved setup has no policy workspace role.");
      elements.policyWorkspaceRole.textContent = copy.role;
      elements.policyWorkspaceTitle.textContent = copy.title;
      elements.policyWorkspaceIntro.textContent = copy.intro;
      elements.policyStartTitle.textContent = copy.startTitle;
      elements.policyStartDescription.textContent = copy.start;
      elements.policyChoicesDescription.textContent = copy.choices;
      elements.policyReviewDescription.textContent = copy.review;
    },
  };
}
