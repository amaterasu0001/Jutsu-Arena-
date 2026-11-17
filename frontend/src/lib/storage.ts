// Browser storage can be unavailable (private mode, blocked site data), so
// every access is guarded and the app works without it.

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // not persisted; the choice still applies for this visit
  }
}
