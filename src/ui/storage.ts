const MUTE_KEY = 'orbit-golf.muted'

/**
 * localStorage throws in some iframes and private-mode browsers. This probes it once and hands
 * back either the real Storage or null, so the rest of the app never has to guard every call.
 */
export function safeLocalStorage(): Storage | null {
  try {
    const probeKey = '__orbit_golf_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return window.localStorage
  } catch {
    return null
  }
}

export function loadMuted(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMuted(storage: Storage | null, muted: boolean): void {
  if (!storage) return
  try {
    storage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // ignore
  }
}
