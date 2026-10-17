// Core's reading of the saved execution policy a reviewed batch binds. The batch module (batch.mjs) stays free of packages and
// takes this reading as `policy`; the host side reads it here, with Core's own parser, and nothing else parses policy bytes.
import { parsePolicy } from '@aihq/core/contracts';
import { readJourneyEnvelope } from './journey.mjs';
// The parsed policy document, or null when the bytes are not UTF-8 or Core refuses them.
export function readSavedPolicy(policyBytes) {
  if (!(policyBytes instanceof Uint8Array)) return null;
  try {
    const parsed = parsePolicy(new TextDecoder('utf-8', { fatal: true }).decode(policyBytes));
    return parsed.valid ? parsed.document : null;
  } catch { return null; }
}
// The same reading of the policy an envelope carries, or null when the envelope or its policy cannot be read.
export async function envelopePolicy(envelopeBytes) {
  if (!(envelopeBytes instanceof Uint8Array)) return null;
  const read = await readJourneyEnvelope(envelopeBytes);
  return read.status === 'ok' ? readSavedPolicy(read.value.savedIntentBytes) : null;
}
// The policy a plan binds: the envelope's own when it is given, else the first plan's saved bytes.
export const planPolicy = async ({ envelopeBytes, savedPolicyBytes }) => envelopeBytes !== undefined ? envelopePolicy(envelopeBytes) : readSavedPolicy(savedPolicyBytes);
