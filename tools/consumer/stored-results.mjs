// The Workbench's reader for the stored Core results it reads (friction.mjs, and through it `./improvements`), exported as
// `aih-ui/stored-results` so the cross-package contract check can run the reader the Workbench actually uses.
//
// A result is read only once the owning package's own public validator accepts it: the Workbench adds no rule of its own.
// Core publishes `validateNativeVerificationResult` for native-verification-result 1.0.0, so that format is read through
// it. Core publishes no validator for file-state-result 1.1.0, so the Workbench cannot check that format and this module
// offers no reader for it; friction.mjs reads it as before, and the contract check reports that format's reader missing.
import { validateNativeVerificationResult } from '@aihq/core/contracts';

export const NATIVE_VERIFICATION_RESULT_SCHEMA = 'urn:aihq:core:native-verification-result:1.0.0';

/**
 * Reads one stored native-verification result (the parsed JSON value) as the Workbench reads it.
 * @returns Core's own validation, `{ valid, schema?, diagnostics }`; anything not valid is not read.
 */
export function readNativeVerificationResult(value) {
  return validateNativeVerificationResult(value);
}
