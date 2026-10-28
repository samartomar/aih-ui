# Policy Workbench

The words the Workbench uses with a person choosing, installing and removing AI content in a project.

## Language

**Tool**:
An AI client the person uses, such as Claude Code or Codex, chosen in the header from the clients Core lists.
_Avoid_: client (on default screens), harness, native client

**Framework**:
A named collection of content released together, such as AIH-Extensions, ECC, Anthropic or Superpowers; the left panel lists release-backed frameworks by their published names. Host-selected internal prepared content is labelled separately.
_Avoid_: family (on default screens), release, catalog, category

**Project basics**:
A framework of shared project guidance. Internal prepared content is explicitly unbound, unauthenticated and non-production until its release obligations are met. The existing project tools and workspace remain accessible separately.
_Avoid_: shared selection, cross-cutting, adapter, harness

**Your sources**:
Content a person or organization brings from outside the installed frameworks, such as a folder on this machine; it sits apart from the frameworks.
_Avoid_: personal content, bring your own, BYO, independent, custom catalog

**Content**:
A Catalog item a person can choose, such as a skill or a command.
_Avoid_: recipe, selection, item (on default screens)

**Project folder**:
The folder that Install writes into and that the installed list reads.
_Avoid_: target, project root, consumer project

**Setup**:
The content a person has chosen for a project folder, with the items those choices need.
_Avoid_: policy, saved intent, composition (on default screens)

**Chosen item**:
Content the person picked directly; it is what the installed list groups by.
_Avoid_: root, explicit selection

**Needed item**:
Content added to the setup because a chosen item depends on it.
_Avoid_: dependency (on default screens), transitive

**Install**:
Writing the setup's files into the project folder after showing the person exactly which files change.
_Avoid_: apply, prepare, stage

**Installed item**:
Content whose files Core records as managed in the project folder.
_Avoid_: managed selection, custody

**Remove**:
Taking a chosen item's files, and those of its needed items that nothing else installed still needs, out of the project folder; the setup's choices are unchanged.
_Avoid_: uninstall, cleanup, managed removal (on default screens)


**Starting set**:
A producer-declared group of content, with exact membership, options and origins
resolved by Catalog. An optional hook stays a separate choice.

**Observed**:
Harness has a published compatibility observation for the selected tool and
platform. This does not prove successful use on the current host.

**Unconfirmed fit**:
The public compatibility result has no observation for the selected tool and
platform. This differs from unsupported fit and from unknown host facts.
