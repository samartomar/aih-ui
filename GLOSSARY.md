# Policy Workbench

The words the Workbench uses with a person choosing, installing and removing AI content in a project.

## Language

**Tool**:
An AI client the person uses, such as Claude Code or Codex, chosen in the header from the clients Core lists.
_Avoid_: client (on default screens), harness, native client

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
