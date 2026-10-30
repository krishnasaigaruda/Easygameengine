import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

/**
 * Loads the Rapier WASM module exactly once. Calling `RAPIER.init()` again while a
 * previous call is in flight re-instantiates the module and invalidates every
 * world/body created against the first instance, so all callers share one promise.
 */
export function loadPhysics(): Promise<typeof RAPIER> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}
