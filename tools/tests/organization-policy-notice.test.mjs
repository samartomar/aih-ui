import test from 'node:test';
import assert from 'node:assert/strict';
import { organizationPolicyNotice } from '../../src/catalog/organization-policy.js';

const github = { provider: 'github', repository: { owner: 'samartomar', name: 'test' }, path: 'gosam.organization-policy.json', revision: { kind: 'branch', value: 'main' } };
const settings = { experience: 'enterprise', role: 'admin', organization: { policyRepo: 'https://github.com/samartomar/test' } };

test('the organisation policy state is said in words: asked once, read, not found, no access', () => {
  const asked = organizationPolicyNotice({ status: 'not-configured', request: { repository: 'samartomar/test', path: 'gosam.organization-policy.json', branch: 'main' } }, settings);
  assert.equal(asked.state, 'not-configured');
  assert.deepEqual(asked.request, { repository: 'samartomar/test', path: 'gosam.organization-policy.json', branch: 'main' });
  assert.match(asked.text, /Name the policy file in samartomar\/test and its branch/);
  assert.match(organizationPolicyNotice({ status: 'ok', source: github, policyId: 'gosam-baseline' }, settings).text, /^Organization policy read: gosam-baseline from samartomar\/test/);
  const missing = organizationPolicyNotice({ status: 'unreadable', source: github, diagnostics: [{ code: 'AUTHORITY_UNAVAILABLE', reason: 'source-missing-or-inaccessible', message: 'x' }] }, settings);
  assert.equal(missing.state, 'not-found'); assert.match(missing.text, /^Organization policy not found: samartomar\/test gosam\.organization-policy\.json \(branch main\)/);
  const denied = organizationPolicyNotice({ status: 'unreadable', source: github, diagnostics: [{ code: 'AUTHORITY_UNAVAILABLE', reason: 'authentication-required-or-denied', message: 'x' }] }, settings);
  assert.equal(denied.state, 'no-access'); assert.match(denied.text, /no access to samartomar\/test.*AIH_CONSUMER_CONTROLS/);
});
