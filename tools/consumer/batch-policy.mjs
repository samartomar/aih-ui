// The saved-policy reader a reviewed batch is given. The batch module (batch.mjs) stays free of packages: each of its operations takes
// `parsePolicy` and reads the exact saved bytes it binds through it. The host side supplies Core's own reader from here.
export { parsePolicy } from '@aihq/core/contracts';
