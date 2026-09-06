export const PREF_HIDE_CANCELLED = 'famcal:hideCancelled'

export function getPref(key: string, defaultVal = false): boolean {
  try { return localStorage.getItem(key) === 'true' } catch { return defaultVal }
}
export function setPref(key: string, val: boolean): void {
  try { localStorage.setItem(key, val ? 'true' : 'false') } catch {}
}
