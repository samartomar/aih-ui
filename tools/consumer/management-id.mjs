/*
 * The id ordinary Enterprise composition gives an item at a scope: scope, package and item id. It also names an
 * organization entry that is never composed. The Workbench builds it itself when it composes a policy, so the page can
 * build it too and look up which Catalog item an installed selection is, without reading Core's id apart.
 *
 * Pure and free of browser and Node built-ins. tools/consumer/management-id.mjs is this same file, because the
 * headless consumer modules don't import from src/; tools/tests/management-id.test.mjs fails if the two differ.
 */

export const managementIdOf = ({ scope, packageName, itemId }) => `${scope}--${packageName.replace(/^@/, '').replaceAll('/', '.')}--${itemId}`;
