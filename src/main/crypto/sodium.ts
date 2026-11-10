import sodium from 'libsodium-wrappers'

/**
 * libsodium (WebAssembly build, no native module; ADR-002). Every use waits for `ready` once.
 * Only the main process loads it; keys never reach the renderer.
 */
export type Sodium = typeof sodium

let ready: Promise<Sodium> | null = null

export function getSodium(): Promise<Sodium> {
    ready ??= sodium.ready.then(() => sodium)
    return ready
}
