// UI-owned Node host. The live prepared handles never leave this module: the UI
// receives a serializable review and an opaque session id, and approval is an
// explicit digest-bound decision against the retained handle. Review JSON is
// never deserialized back into executable work.
import { randomUUID } from 'node:crypto';
import { apply, prepare, prepareManagedRemoval, listManagedSelections } from '@aihq/core';
import { parsePolicy, parseOrganizationPolicy } from '@aihq/core/contracts';
import { readGitHubPolicy } from '@aihq/core/harness/runtime';
import { previewPolicyAuthority } from './organization.mjs';

const lostResult = () => ({
  status: 'lost',
  diagnostics: [{
    code: 'SESSION_LOST', reason: 'unknown-or-consumed-session',
    message: 'This preparation is no longer held by the host; prepare and approve again.'
  }]
});

// organizationSource (Enterprise only) is host configuration, never browser input.
export function createHost({ projectRoot, materialRoots, organizationSource, recipeMaterials = [], controls: hostControls } = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('createHost requires a host-configured projectRoot');
  }
  const sessions = new Map();

  const controlsFor = controls => ({
    ...hostControls, ...controls,
    materialRoots: controls?.materialRoots ?? materialRoots
  });

  const retain = preparation => {
    const result = { status: preparation.status, diagnostics: preparation.diagnostics,
      ...(preparation.resolutionInputs ? { resolutionInputs: preparation.resolutionInputs } : {}) };
    if (preparation.review) result.review = JSON.parse(JSON.stringify(preparation.review));
    if (preparation.prepared) {
      const sessionId = randomUUID();
      sessions.set(sessionId, { handle: preparation.prepared, reviewDigest: preparation.review.reviewDigest });
      result.sessionId = sessionId;
    }
    return result;
  };
  async function inspectAuthority({ policyText, controls } = {}) {
    const parsed = parsePolicy(policyText);
    if (!parsed.valid) return { status: 'refused', diagnostics: parsed.diagnostics };
    if (parsed.document.mode === 'vibe') return { status: 'ok', value: { mode: 'vibe', advisory: true, authority: null, affectedChoices: [], stillValidChoices: [] }, diagnostics: [] };
    const { authentication, signal } = controlsFor(controls);
    const read = await readGitHubPolicy(organizationSource, { ...(authentication ? { authentication } : {}), ...(signal ? { signal } : {}) });
    if (read.status !== 'read') return { status: 'refused', diagnostics: [{ code: read.code, reason: read.reason, message: read.message }], authority: { source: read.source, helper: read.helper, accounting: read.accounting } };
    const organization = parseOrganizationPolicy(new TextDecoder().decode(read.bytes));
    if (!organization.valid) return { status: 'refused', diagnostics: organization.diagnostics };
    const result = await previewPolicyAuthority({ policy: parsed.document, organization: organization.document, recipeMaterials, privateInputs: controlsFor(controls).privateInputs });
    const authority = { source: read.source, resolvedCommit: read.resolvedCommit, blobId: read.blobId, contentDigest: read.contentDigest, policyId: organization.document.id, retrievedAt: read.retrievedAt, helper: read.helper, accounting: read.accounting };
    return result.status === 'ok' ? { ...result, value: { ...result.value, authority } } : { ...result, authority };
  }
  return {
    inspectAuthority,
    managedInventory() { return listManagedSelections({ target: { project: projectRoot }, scope: 'project' }); },
    async prepareRemovalSession({ managementId, scope, mode, controls } = {}) {
      const result = await prepareManagedRemoval({ target: { project: projectRoot }, managementId, scope, mode,
        ...(mode === 'enterprise' ? { organizationSource } : {}) }, controlsFor(controls));
      return { ...result, ...(result.preparation ? { preparation: retain(result.preparation) } : {}) };
    },
    async prepareSession({ policyText, resolutions, controls } = {}) {
      const parsed = parsePolicy(policyText);
      if (!parsed.valid) return { status: 'invalid', diagnostics: parsed.diagnostics };
      const authority = await inspectAuthority({ policyText, controls });
      const preparation = await prepare(
        { useCase: 'policy', policy: parsed.document, target: { project: projectRoot },
          ...(resolutions ? { resolutions } : {}),
          ...(parsed.document.mode === 'enterprise' ? { organizationSource } : {}) },
        controlsFor(controls)
      );
      return { ...retain(preparation), authority };
    },

    async applyApproved({ sessionId, reviewDigest, origin = 'interactive', controls } = {}) {
      const session = sessions.get(sessionId);
      if (!session) return lostResult();
      if (reviewDigest !== session.reviewDigest) {
        return {
          status: 'rejected',
          reason: 'digest-mismatch',
          diagnostics: [{
            code: 'APPROVAL_REJECTED', reason: 'digest-mismatch',
            message: 'Approval must name the exact review digest returned by preparation.'
          }]
        };
      }
      sessions.delete(sessionId);
      return apply(
        session.handle,
        { approved: true, origin, reviewDigest },
        controlsFor(controls)
      );
    }
  };
}
