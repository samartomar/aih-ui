// The saved-policy reader and recipe operation kinds a reviewed batch is given. The batch module (batch.mjs) stays free of packages: each of its
// operations takes `parsePolicy` and reads the exact saved bytes it binds through it, and takes `operationKinds` to say which actions Core can verify.
// The host side supplies Core's own reader and published kinds from here.
export { parsePolicy, recipeOperationKinds } from '@aihq/core/contracts';
