// The Workbench's readers for the stored Core results it reads (friction.mjs, and through it `./improvements`), exported as
// `aih-ui/stored-results` so the cross-package contract check can run the readers the Workbench actually uses.
//
// A result is read only once the owning package's own public validator accepts it: the Workbench adds no rule of its own,
// and each reader returns Core's result unchanged, `{ valid, schema?, diagnostics }`.
// - native-verification-result 1.0.0: Core's `validateNativeVerificationResult`.
// - file-state-result 1.1.0: Core's `validateFileStateResult`. A Core that does not publish it leaves the Workbench nothing
//   to check file-state results with: `fileStateReaderAvailable` is false, `readFileStateResult` throws, and friction.mjs
//   reads them as it always did, unchecked.
import * as coreContracts from '@aihq/core/contracts';

export const NATIVE_VERIFICATION_RESULT_SCHEMA = 'urn:aihq:core:native-verification-result:1.0.0';
export const FILE_STATE_RESULT_SCHEMA = 'urn:aihq:core:file-state-result:1.1.0';

/** Whether the installed Core publishes the validator the file-state reader needs. */
export const fileStateReaderAvailable = typeof coreContracts.validateFileStateResult === 'function';

/**
 * Reads one stored native-verification result (the parsed JSON value) as the Workbench reads it.
 * @returns Core's own validation, `{ valid, schema?, diagnostics }`; anything not valid is not read.
 */
export function readNativeVerificationResult(value) {
  return coreContracts.validateNativeVerificationResult(value);
}

/**
 * Reads one stored file-state result (the parsed JSON value) as the Workbench reads it.
 * @returns Core's own validation, `{ valid, schema?, diagnostics }`; anything not valid is not read.
 * @throws when the installed Core publishes no `validateFileStateResult`.
 */
export function readFileStateResult(value) {
  if (!fileStateReaderAvailable) throw new TypeError('The installed @aihq/core publishes no validateFileStateResult, so a file-state result cannot be checked.');
  return coreContracts.validateFileStateResult(value);
}
