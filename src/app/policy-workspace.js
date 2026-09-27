/* Role-specific presentation only. Saved setup is not policy authority. */
import { collectIds } from "./dom.js";

const COPY = {
  vibe: {
    role: "Vibe Coder · Project policy",
    title: "Your project policy",
    intro: "This space is for a policy saved separately for each project or AI CLI. The CLI applies the finished file.",
    startTitle: "Project starting point",
    start: "Choosing a starting point or opening an existing project policy needs Core's published authoring and file contracts.",
    choices: "Project selections will appear here when Core can bind catalog items to a policy draft.",
    review: "A complete project policy can be reviewed and saved here once Core supplies validation and serialization.",
  },
  admin: {
    role: "Enterprise Admin · Organization policy",
    title: "Organization policy",
    intro: "Prepare a policy in a local organization workspace. You handle Git commit and push after saving the finished file.",
    startTitle: "Organization starting point",
    start: "You can open a local PolicyBundle and inspect a Decision V2 with Core's structural parsers. Starting points and editable import need published authoring contracts.",
    choices: "Required, Optional and Blocked choices belong here when Core defines their policy meaning and Catalog supplies exact item bindings.",
    review: "Full validation and writing the finished policy into a chosen local workspace need Core's file and serialization contracts.",
  },
  developer: {
    role: "Enterprise Developer · Project policy",
    title: "Project policy under your organization",
    intro: "Open the policy supplied by your admin, then save a separate policy for your project. The organization policy stays read-only.",
    startTitle: "Organization policy and project start",
    start: "Open the local organization PolicyBundle supplied by your admin, or inspect a local Decision V2. Core checks structure only; approval and GitHub loading are not verified here.",
    choices: "After Core confirms the approved organization policy, define a separate project policy here: retain Required items, choose or omit approved Optional items, and never add Blocked items.",
    review: "Review and save a separate project policy here once Core publishes narrowing, validation and serialization.",
  },
};

export function createPolicyWorkspace() {
  const elements = collectIds([
    "policy-workspace-role", "policy-workspace-title", "policy-workspace-intro",
    "policy-start-title", "policy-start-description", "policy-choices-description",
    "policy-review-description", "policy-file-review",
  ]);
  let role = "vibe";
  return {
    setSettings(settings) {
      role = settings.experience === "vibe" ? "vibe" : settings.role;
      const copy = COPY[role];
      if (!copy) throw new Error("Saved setup has no policy workspace role.");
      elements.policyWorkspaceRole.textContent = copy.role;
      elements.policyWorkspaceTitle.textContent = copy.title;
      elements.policyWorkspaceIntro.textContent = copy.intro;
      elements.policyStartTitle.textContent = copy.startTitle;
      elements.policyStartDescription.textContent = copy.start;
      elements.policyChoicesDescription.textContent = copy.choices;
      elements.policyReviewDescription.textContent = copy.review;
      elements.policyFileReview.hidden = true;
      elements.policyFileReview.textContent = "";
    },
    setFileReview(review) {
      elements.policyFileReview.hidden = review === null;
      if (review === null) {
        elements.policyFileReview.textContent = "";
        return;
      }
      const status = review.state === "accepted" ? "Core accepted the decoded structure" : review.state === "refused" ? "File structure not accepted" : "File review could not complete";
      const approval = role === "developer" && review.state === "accepted" ? " Approval is not verified; project choices remain unavailable." : "";
      elements.policyFileReview.textContent = `${review.name}: ${status}.${approval}`;
    },
  };
}
