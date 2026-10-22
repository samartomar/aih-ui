// A GitHub repository at an exact commit becomes content through the same public Catalog path as a folder on this
// machine: Catalog's source reader recognizes each <path>/<name>/SKILL.md (recognizeSkills, shared with the folder
// source) and Catalog's producer compiles them with the repository and commit as the source (a git origin). The bytes
// come from ./github-archive.mjs; nothing here fetches, resolves or runs anything.
import { intakeDeclaration } from './intake.mjs';
import { recognizeSkills } from './personal-folder.mjs';
import { archiveUrl, checkGitHubSource, downloadArchive, extractCommitArchive } from './github-archive.mjs';
import { digestBytes, refuse, stable } from './primitives.mjs';
const encode = value => new TextEncoder().encode(value);
export const GITHUB_SKILLS = 32;
// Catalog has no material source for a git origin yet (samartomar/aih-catalog#124), so content from GitHub can be
// chosen but never installed. Its material source names an input that no host grants a folder for.
export const NOT_INSTALLABLE = "Content from a GitHub repository can't be installed yet: Catalog does not publish a material source for a git commit (samartomar/aih-catalog#124). It can be browsed and chosen; nothing from it was written to your project.";
export const githubInput = commit => `github-${commit.slice(0, 24)}`;

/** The checked source and its kept files (repository paths) as an inventory, or Catalog's refusal. */
export async function intakeGitHubSource({ owner, repo, commit, path }, { files, licensePath }) {
  const fail = (message, details) => refuse('GITHUB_SOURCE_INVALID', '/files', message, undefined, details);
  if (!licensePath) return fail(`Add a LICENSE, LICENSE.txt or LICENSE.md to ${path} or the repository root at that commit. Its text travels with each skill.`);
  const paths = Object.keys(files).filter(member => member.startsWith(`${path}/`) && /^[^/]+\/SKILL\.md$/.test(member.slice(path.length + 1))).sort();
  if (!paths.length || paths.length > GITHUB_SKILLS) return fail(`Recognized layout: ${path}/<name>/SKILL.md (1 to ${GITHUB_SKILLS} skills). Name the folder that holds one folder per skill.`);
  let items, license;
  try {
    if (!new TextDecoder('utf-8', { fatal: true }).decode(files[licensePath]).trim()) throw new Error(`${licensePath} must contain UTF-8 text.`);
    ({ items, license } = recognizeSkills({ files, paths, licensePath, revision: commit, skillsDirectory: path, source: 'github', acquisition: 'GitHub acquisition', undeclaredLicense: 'LicenseRef-Undeclared' }));
  } catch (error) { return fail(error.message, error.sourceFacts ? { owner: 'catalog', sourceFacts: error.sourceFacts } : undefined); }
  const repository = `${owner}/${repo}`;
  const declarationBytes = encode(stable({ schema: 'urn:aihq:catalog:producer-declaration:3.1.0', format: 'aihq-catalog-producer-declaration', version: 3,
    package: { name: `github-${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-'), version: '0.0.0' },
    sources: [{ id: 'github', repository, licensePath, license }], items }));
  const input = githubInput(commit);
  const result = await intakeDeclaration({ declarationBytes, sourceFiles: [{ source: 'github', revision: commit, files }],
    input: { id: input, kind: 'git', locator: { repository: `https://github.com/${repository}` }, resolvedIdentity: { revision: commit, sha256: await digestBytes(declarationBytes) } },
    materialSource: { kind: 'local', input } });
  if (result.status !== 'ok') return result;
  // The family is the host's grouping for Your sources; the exact repository, commit and folder travel with it.
  Object.assign(result.value, { family: 'Personal', github: { repository, commit, path }, installable: false });
  return result;
}

/** Checks the input (nothing is fetched unless it is exact), downloads that commit and builds its inventory. */
export async function acquireGitHubSource(body, { download = downloadArchive } = {}) {
  const checked = checkGitHubSource(body);
  if (checked.status !== 'ok') return checked;
  const fetched = await download(archiveUrl(checked.value));
  if (fetched.status !== 'ok') return fetched;
  const extracted = extractCommitArchive(fetched.value, checked.value);
  if (extracted.status !== 'ok') return extracted;
  return intakeGitHubSource(checked.value, extracted.value);
}
