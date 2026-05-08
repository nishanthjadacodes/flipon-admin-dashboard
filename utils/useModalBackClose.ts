// Hook: when a modal is open, intercept the browser back button so it
// CLOSES the modal instead of navigating away from the page. Common
// problem in single-page admin dashboards — user opens an order
// preview, taps the back arrow on their phone or trackpad, and the
// whole admin section unloads.
//
// Mechanism: while `open` is true we push a synthetic history entry
// (`#modal`). The browser's back button then triggers a `popstate`
// from that entry — we intercept it, call `onClose()`, and the page
// stays put. When the modal closes via any other path (X button,
// click-outside, success), we go(-1) ourselves to clean up the entry.
//
// Caveats: works on browsers; no-op when `window` is undefined (SSR).
// Multiple stacked modals: each call pushes its own entry, so back
// closes them one at a time (innermost first), matching user
// expectation for nested previews.

'use client';

import { useEffect, useRef } from 'react';

export function useModalBackClose(open: boolean, onClose: () => void): void {
  const pushedRef = useRef<boolean>(false);
  const onCloseRef = useRef(onClose);
  // Keep the latest onClose callback without re-binding the popstate
  // listener every render — re-binding mid-modal would race the
  // history entry against the listener.
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (open && !pushedRef.current) {
      // Push a sentinel state so the upcoming popstate is OURS, not the
      // user's actual previous page. The hash makes it visible in the
      // address bar so devs can spot it during debugging.
      window.history.pushState({ flipModalOpen: true }, '', window.location.href);
      pushedRef.current = true;

      const onPop = (): void => {
        // Browser back fired and consumed our sentinel. Close the modal.
        // Mark pushedRef false BEFORE calling onClose so the cleanup
        // effect below doesn't try to go(-1) again.
        pushedRef.current = false;
        onCloseRef.current();
      };
      window.addEventListener('popstate', onPop);

      return () => {
        window.removeEventListener('popstate', onPop);
        // If the modal was closed by anything OTHER than the browser
        // back (X, click-outside, success path), our sentinel is still
        // sitting on top of the history. Pop it so the next real back
        // navigates the user where they expect.
        if (pushedRef.current) {
          pushedRef.current = false;
          window.history.back();
        }
      };
    }
    return undefined;
  }, [open]);
}
