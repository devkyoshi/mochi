/**
 * Opening a native dialog (e.g. the folder picker) takes focus from Mochi's window, which would
 * trigger "collapse when I click elsewhere" and destroy whatever the user was doing. While a dialog
 * is open, blur events are ignored.
 */
let open = 0;

/** How long after a dialog closes focus changes are still treated as part of it. */
export const RELEASE_DELAY_MS = 600;

export function isAutoCollapseSuspended(): boolean {
  return open > 0;
}

/** Run `fn` (which opens a native dialog) with auto-collapse suspended until shortly after it finishes. */
export async function withAutoCollapseSuspended<T>(fn: () => Promise<T>): Promise<T> {
  open++;
  try {
    return await fn();
  } finally {
    setTimeout(() => {
      open = Math.max(0, open - 1);
    }, RELEASE_DELAY_MS);
  }
}
