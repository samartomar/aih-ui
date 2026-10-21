// Controlled source-profile fixtures supplement the installed maintained inventory.
import { readFile } from 'node:fs/promises';
import { digestBytes } from './primitives.mjs';
import { intakeDeclaration } from './intake.mjs';
export const sourceExamples = [
  { id: 'command', profile: 'claude-command', text: '---\nallowed-tools: Read, Grep\nargument-hint: <path>\n---\nRead the selected path.\n' },
  { id: 'hooks', profile: 'claude-hooks', text: JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo reviewed-handler' }] }] } }) },
  { id: 'mcp', profile: 'claude-mcp-registration', key: 'example', text: JSON.stringify({ mcpServers: { example: { command: 'example-server', args: ['--read-only'], env: { API_TOKEN: 'fixture-sensitive-value' } } } }) },
  { id: 'required', profile: 'agent-skills', text: '---\nname: required\n---\nDo not invent purpose from this body.\n' },
  { id: 'malformed', profile: 'claude-command', text: '---\nname: [invalid\n---\n' }
];
export async function sourceExample(example) {
  const encode = value => new TextEncoder().encode(value);
  const recipe = JSON.parse(await readFile(new URL('./fixtures/review-note/recipe.json', import.meta.url), 'utf8'));
  recipe.id = `source-proof.${example.id}`;
  const path = `source/${example.id}.${['hooks', 'mcp'].includes(example.id) ? 'json' : 'md'}`;
  const declaration = { schema: 'urn:aihq:catalog:producer-declaration:3.1.0', format: 'aihq-catalog-producer-declaration', version: 3,
    package: { name: `source-proof-${example.id}`, version: '1.0.0' }, sources: [{ id: 'example', origin: { kind: 'local' }, licensePath: 'LICENSE', license: 'MIT' }],
    items: [{ id: recipe.id, source: 'example', kind: 'instruction', label: 'Delivery label', description: 'Delivery description', recipePath: 'recipe.json',
      sourceDiscovery: { profile: example.profile, path, ...(example.key ? { key: example.key } : {}) },
      materials: [{ id: 'license', path: 'LICENSE' }, { id: 'note', path }], requires: [], optional: [], conflicts: [], clientCapabilities: [], activation: [], configuration: {} }] };
  const declarationBytes = encode(JSON.stringify(declaration));
  const snapshot = { input: { id: `source-${example.id}`, kind: 'local', locator: { input: `source-${example.id}` }, resolvedIdentity: { sha256: await digestBytes(declarationBytes) } },
    declarationBytes, sourceFiles: [{ source: 'example', revision: 'a'.repeat(64), files: { 'recipe.json': encode(JSON.stringify(recipe)), LICENSE: encode('MIT fixture license terms.'), [path]: encode(example.text) } }], materialSource: { kind: 'local', input: `source-${example.id}` } };
  return { snapshot, result: await intakeDeclaration(snapshot) };
}
