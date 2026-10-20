// Browser-granted bytes only. No path acquisition, scripts, Git or network.
import { extractSourceFacts } from '@aihq/catalog/source';
import { intakeDeclaration } from './intake.mjs';
import { checkInput } from './intent-shape.mjs';
import { digestBytes, only, refuse, stable } from './primitives.mjs';
const encode = value => new TextEncoder().encode(value);
export const FOLDER_LIMITS = { files: 256, fileBytes: 250_000, totalBytes: 1_000_000, skills: 32 };
const safePath = path => typeof path === 'string' && path.length <= 240
  && path.split('/').every(part => /^[A-Za-z0-9_. -]+$/.test(part) && !['', '.', '..', '.git'].includes(part.toLowerCase())
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export async function intakePersonalFolder({ files: supplied, rebind } = {}) {
  const fail = message => refuse('LOCAL_FOLDER_INVALID', '/files', message);
  if (!Array.isArray(supplied) || !supplied.length || supplied.length > FOLDER_LIMITS.files) return fail('Choose a folder with 1–256 regular files, up to 250 KB per file and 1 MB total.');
  if (rebind !== undefined && (!checkInput(rebind) || rebind.kind !== 'local' || !rebind.id.startsWith('personal-'))) return fail('Rebind requires the exact saved personal input identity; it cannot supply a host path or grant.');
  const files = Object.create(null), aliases = new Set(); let total = 0;
  for (const file of supplied) {
    if (!only(file, ['path', 'bytes']) || !safePath(file.path) || aliases.has(file.path.toLowerCase())
      || !Array.isArray(file.bytes) || file.bytes.length > FOLDER_LIMITS.fileBytes || !file.bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) return fail('Use unique canonical relative file paths and byte arrays. Traversal, absolute paths, case aliases and reserved names are refused.');
    total += file.bytes.length;
    if (total > FOLDER_LIMITS.totalBytes) return fail('Folder exceeds 1 MB; choose a smaller skill tree.');
    aliases.add(file.path.toLowerCase()); files[file.path] = Uint8Array.from(file.bytes);
  }
  if ([...aliases].some(path => [...aliases].some(other => other.startsWith(path + '/')))) return fail('A selected file cannot also be another file’s parent directory. Choose a regular skill tree.');
  // Revision = SHA256 of sorted [relative path, SHA256(bytes), byte length] JSON.
  const tree = await Promise.all(Object.keys(files).sort().map(async path => [path, await digestBytes(files[path]), files[path].length]));
  const revision = await digestBytes(encode(JSON.stringify(tree)));
  const inputId = rebind?.id ?? `personal-${revision.slice(0, 24)}`;
  const licensePath = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'].find(path => files[path]);
  if (!licensePath || !files[licensePath].length) return fail('Add a nonempty LICENSE, LICENSE.txt or LICENSE.md at the chosen folder root. Its bytes travel with each skill.');
  const paths = Object.keys(files).filter(path => /^skills\/[^/]+\/SKILL.md$/.test(path)).sort();
  if (!paths.length || paths.length > FOLDER_LIMITS.skills) return fail('Recognized layout: skills/<name>/SKILL.md (up to 32 skills). Choose the parent folder containing skills/ and the root LICENSE. Other formats need an advanced prepared declaration.');
  let items, license;
  try {
    if (!decode(files[licensePath]).trim()) throw new Error('The root license must contain UTF-8 text.');
    const names = new Set();
    items = paths.map(path => {
      const facts = extractSourceFacts({ profile: 'agent-skills', path, revision, bytes: files[path] });
      if (facts.status !== 'valid') {
        const error = new Error(`${path}: ${facts.status} — ${facts.diagnostics.map(value => `${value.field}: ${value.message}`).join('; ')}. Check Agent Skills front matter.`);
        error.sourceFacts = facts;
        throw error;
      }
      const fields = { name: facts.name.value, description: facts.description.value, license: facts.native.license ?? 'LicenseRef-Personal' }, directory = path.slice(0, -'SKILL.md'.length);
      if (directory && directory !== `skills/${fields.name}/`) throw new Error(`${path}: directory must match the declared name ${fields.name}.`);
      if (names.has(fields.name)) throw new Error(`${path}: duplicate skill name.`);
      names.add(fields.name);
      license ??= fields.license;
      if (license !== fields.license) throw new Error('All skills must declare the same root license identifier. Use advanced declarations for multiple licenses.');
      return { id: `personal.skill.${fields.name}`, source: 'personal', skillPath: path, sourceDiscovery: { profile: 'agent-skills', path },
        supportPaths: Object.keys(files).filter(member => member.startsWith(directory) && member !== path && member !== licensePath).map(member => member.slice(directory.length)).sort(),
        label: fields.name, description: fields.description, kind: 'skill', requires: [], optional: [], conflicts: [],
        clientCapabilities: [
          { client: 'claude-code', surface: '.claude/skills', capability: 'skill-material-format', support: 'supported', reason: 'Recognized SKILL.md material layout; validated through Catalog. Native use is unobserved.' },
          { client: 'claude-code', surface: 'agent-tools', capability: 'native-execution', support: 'unknown', reason: 'Folder acquisition does not execute supplied code or observe native use.' },
          { client: 'claude-code', surface: 'agent-tools', capability: 'automatic-guardrails', support: 'unsupported', reason: 'Skill instructions do not intercept or enforce tool execution.' }
        ], activation: [], configuration: { agentDirectory: { type: 'string', required: true, default: '.claude', minLength: 1, maxLength: 64,
          description: 'Project directory that receives skills/<name>/ (Claude Code reads .claude).' } } };
    });
  } catch (error) { return refuse('LOCAL_FOLDER_INVALID', '/files', error.message, undefined,
    error.sourceFacts ? { owner: 'catalog', sourceFacts: error.sourceFacts } : undefined); }
  const declarationBytes = encode(stable({ schema: 'urn:aihq:catalog:producer-declaration:3.1.0', format: 'aihq-catalog-producer-declaration', version: 3,
    package: { name: 'personal-skills', version: '0.0.0' }, sources: [{ id: 'personal', origin: { kind: 'local' }, licensePath, license }], items }));
  const result = await intakeDeclaration({ declarationBytes, sourceFiles: [{ source: 'personal', revision, files }],
    input: { id: inputId, kind: 'local', locator: { input: inputId }, resolvedIdentity: { sha256: await digestBytes(declarationBytes) } },
    materialSource: { kind: 'local', input: inputId } });
  if (result.status === 'ok' && rebind && (result.value.release.sha256 !== rebind.releaseSha256 || result.value.input.resolvedIdentity.sha256 !== rebind.resolvedIdentity.sha256)) {
    return refuse('LOCAL_ROOT_CHANGED', '/rebind', 'This folder differs from the saved exact snapshot. Original choices are retained. Restore the original bytes to rebind. To use changed content, download the original policy, explicitly start a fresh draft and add the folder as new content; no root is silently remapped.');
  }
  if (result.status === 'ok') result.value.family = 'Personal';
  return result;
}
