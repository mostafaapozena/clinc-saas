// Browser storage for UI preferences only (language, last organization, branch choice).
// Never used for credentials or anything that grants access.

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); preferences are then per page load.
  }
}

export const LAST_ORG_KEY = 'clinc.lastOrganization';
export const branchKey = (orgId: string) => `clinc.branch.${orgId}`;
