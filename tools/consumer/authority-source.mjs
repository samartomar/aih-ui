// Reads the host-configured organization source through Core's reader. The source is
// host configuration only; callers pass the value given to startConsumer/createHost.
import { parseOrganizationPolicy } from '@aihq/core/contracts';
import { readGitHubPolicy } from '@aihq/core/harness/runtime';

// Shared with host.inspectAuthority, which also needs the parsed document and reader facts.
export async function readOrganization({ organizationSource, controls } = {}) {
  const { authentication, signal } = controls ?? {};
  const read = await readGitHubPolicy(organizationSource, { ...(authentication ? { authentication } : {}), ...(signal ? { signal } : {}) });
  if (read.status !== 'read') return { status: 'unreadable', read, diagnostics: [{ code: read.code, reason: read.reason, message: read.message }] };
  const organization = parseOrganizationPolicy(new TextDecoder().decode(read.bytes));
  if (!organization.valid) return { status: 'invalid', read, diagnostics: organization.diagnostics };
  const authority = { source: read.source, resolvedCommit: read.resolvedCommit, blobId: read.blobId, contentDigest: read.contentDigest,
    policyId: organization.document.id, retrievedAt: read.retrievedAt, helper: read.helper, accounting: read.accounting };
  return { status: 'ok', read, organization: organization.document, authority, diagnostics: [] };
}

export async function readAuthoritySource({ organizationSource, controls } = {}) {
  if (organizationSource === undefined) return { status: 'not-configured', source: null, authority: null, diagnostics: [] };
  const result = await readOrganization({ organizationSource, controls });
  if (result.status === 'ok') return { status: 'ok', source: result.read.source, authority: result.authority, diagnostics: [] };
  return { status: 'refused', source: result.read.source ?? null, authority: null, diagnostics: result.diagnostics };
}
