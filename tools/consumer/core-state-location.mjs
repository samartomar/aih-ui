// Core owns these locations. This adapter reads its public Node resolver for this process and
// its portable descriptor for other home folders protected by the Workbench's existing checks.
import { isAbsolute, join } from 'node:path';

export const stateLocationUnavailable = "Core's state location is unavailable. The Workbench cannot check whether this folder contains Core's records. Try again with a Core package that publishes its state location.";

export function stateRootForHome(home, descriptor) {
  if (descriptor?.base !== 'userHome' || !Array.isArray(descriptor.segments) || !descriptor.segments.length
    || descriptor.segments.some(value => typeof value !== 'string' || !value || value === '.' || value === '..' || /[/\\]/.test(value))
    || typeof home !== 'string' || !isAbsolute(home)) throw new Error(stateLocationUnavailable);
  return join(home, ...descriptor.segments);
}

export function readCoreState(coreState) {
  try {
    const location = coreState?.resolveStateLocation?.();
    if (!location || typeof location.root !== 'string' || !isAbsolute(location.root)) return { status: 'unavailable', reason: stateLocationUnavailable };
    // Check that the portable descriptor is usable without inferring any of its folder names.
    stateRootForHome(location.root, coreState.stateLocation?.root);
    return { status: 'available', root: location.root, descriptor: coreState.stateLocation.root };
  } catch { return { status: 'unavailable', reason: stateLocationUnavailable }; }
}
