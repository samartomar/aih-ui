// Core's state location as this process's Core publishes it. Core is an optional peer of the checkout, so this module
// is only ever loaded from the installed consumer, where Node follows the package's import export map.
export async function loadCoreState() {
  const [core, contracts] = await Promise.all([import('@aihq/core'), import('@aihq/core/contracts')]);
  return { resolveStateLocation: core.resolveStateLocation, stateLocation: contracts.stateLocation };
}
