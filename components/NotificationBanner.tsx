'use client';

// Top-down in-app notification banner for the admin dashboard.
// Mirrors the RN apps' banner: polls /notifications/inbox?unread_only=true
// on mount + every 30 seconds, slides the topmost unseen notification in
// from the top of the screen, and routes the admin to the relevant section
// on tap.
//
// Notifications come from backend events (booking-created, enquiry-requested,
// etc). Each carries a `deep_link` like { route: 'orders', bookingId: '...' }
// that this component translates to a section change in the parent
// dashboard via the `onNavigate` callback.

import { useEffect, useState, useCallback, useRef } from 'react';
import { inboxAPI } from '@/utils/api';

interface InboxNotification {
  id: string | number;
  type: string;
  title: string;
  body?: string | null;
  deep_link?: { route?: string; bookingId?: string; enquiryId?: string } | null;
  metadata?: any;
  seen_at?: string | null;
  created_at?: string;
}

interface Props {
  // Called when user taps a banner that has a deep_link.route. Parent
  // (dashboard) decides what to do — typically setActiveSection(route)
  // and possibly remember the bookingId/enquiryId for highlight.
  onNavigate?: (route: string, params?: Record<string, unknown>) => void;
}

// 5-minute polling — was 30s. Too aggressive at 30s: even if every
// dedup layer catches a duplicate, that's still a network round-trip
// every 30 seconds for the entire admin team. Five minutes is plenty
// for "show me when something new arrives" without feeling spammy.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export default function NotificationBanner({ onNavigate }: Props) {
  const [queue, setQueue] = useState<InboxNotification[]>([]);
  const [current, setCurrent] = useState<InboxNotification | null>(null);
  const [visible, setVisible] = useState<boolean>(false);
  const [dragX, setDragX] = useState<number>(0);
  const dragStartXRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local "dismissed" memory — THREE layers of dedup. The previous
  // two (by ID and by content key) weren't enough — sessionStorage
  // only persists per-tab, so opening the dashboard in a new tab
  // (or after a strict-mode double-mount in dev) replayed every
  // notification that was already dismissed in another session.
  //
  //   1. By notification ID — handles the race where markRead is in
  //      flight when the next poll fires.
  //   2. By content hash (type|title|body) — handles backend rows
  //      with different IDs but identical content (booking creation
  //      retried by the customer app, fan-out to multiple admin
  //      user_ids belonging to the same person, etc.). 10-minute
  //      window so an identical event later still shows once.
  //   3. High-water-mark ID — any notification whose ID is <= the
  //      last-seen ID is dropped. Notification IDs are monotonic
  //      BIGINTs from the DB, so once you've seen ID 47, the
  //      banner never re-shows IDs 1..47 ever, on any tab.
  //
  // ALL persistence moved from sessionStorage to localStorage so
  // dismissals survive: tab close, browser restart, multi-tab
  // dashboards, dev hot-reloads, role switches, and section changes.
  const STORE_DISMISSED_IDS = 'flipone_admin_dismissed_notifs';
  const STORE_DISMISSED_CONTENT = 'flipone_admin_dismissed_content';
  const STORE_HIGH_WATERMARK = 'flipone_admin_notif_high_watermark';
  const CONTENT_DEDUP_WINDOW_MS = 10 * 60 * 1000;

  const dismissedIdsRef = useRef<Set<string>>(
    typeof window === 'undefined'
      ? new Set()
      : (() => {
          try {
            const raw = localStorage.getItem(STORE_DISMISSED_IDS);
            if (!raw) return new Set<string>();
            return new Set<string>(JSON.parse(raw));
          } catch {
            return new Set<string>();
          }
        })(),
  );

  // Map<contentKey, timestamp> — same as dismissedIdsRef but keyed
  // by content + bounded by CONTENT_DEDUP_WINDOW_MS.
  const dismissedContentRef = useRef<Map<string, number>>(
    typeof window === 'undefined'
      ? new Map()
      : (() => {
          try {
            const raw = localStorage.getItem(STORE_DISMISSED_CONTENT);
            if (!raw) return new Map<string, number>();
            const arr: [string, number][] = JSON.parse(raw);
            return new Map<string, number>(arr);
          } catch {
            return new Map<string, number>();
          }
        })(),
  );

  // High water mark — highest notification ID the user has dismissed.
  // Polled rows with id <= this are unconditionally filtered out.
  const highWatermarkRef = useRef<number>(
    typeof window === 'undefined'
      ? 0
      : (() => {
          try {
            const raw = localStorage.getItem(STORE_HIGH_WATERMARK);
            return raw ? Number(raw) || 0 : 0;
          } catch {
            return 0;
          }
        })(),
  );

  // Session-start timestamp — any notification whose created_at is
  // older than this moment is treated as "backlog" and skipped from
  // the banner. The bell-dropdown still lists them. Without this gate
  // the admin saw the old backlog spam every time they opened the
  // dashboard if any inbox row had slipped past the watermark/dedup
  // (e.g. backend created rows out-of-order, or the user cleared
  // localStorage).
  const sessionStartRef = useRef<number>(Date.now());

  const contentKeyFor = (n: InboxNotification): string =>
    `${n.type}|${n.title}|${n.body || ''}`;

  // Helper that keeps both Sets + the watermark ↔ localStorage in
  // sync after every dismissal. Failures (storage quota, private
  // mode) are swallowed — in-memory state is still the source of
  // truth for the current page session.
  const rememberDismissed = (n: InboxNotification): void => {
    dismissedIdsRef.current.add(String(n.id));
    dismissedContentRef.current.set(contentKeyFor(n), Date.now());
    // Bump the high-water mark ONLY when the new ID exceeds it.
    // Prevents an old notification (out-of-order delivery, manual
    // delete + recreate) from clobbering the watermark.
    const idNum = Number(n.id);
    if (Number.isFinite(idNum) && idNum > highWatermarkRef.current) {
      highWatermarkRef.current = idNum;
    }
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        STORE_DISMISSED_IDS,
        JSON.stringify(Array.from(dismissedIdsRef.current).slice(-200)),
      );
      localStorage.setItem(
        STORE_DISMISSED_CONTENT,
        JSON.stringify(Array.from(dismissedContentRef.current).slice(-200)),
      );
      localStorage.setItem(STORE_HIGH_WATERMARK, String(highWatermarkRef.current));
    } catch {}
  };

  // Returns true if a notification should be skipped:
  //   - its ID is at-or-below the high-water mark (already seen any
  //     prior notification), OR
  //   - its exact ID was already dismissed, OR
  //   - an identical-content notification was dismissed within the
  //     content dedup window.
  const isAlreadyHandled = (n: InboxNotification): boolean => {
    const idNum = Number(n.id);
    if (Number.isFinite(idNum) && idNum <= highWatermarkRef.current) return true;
    if (dismissedIdsRef.current.has(String(n.id))) return true;
    const contentTs = dismissedContentRef.current.get(contentKeyFor(n));
    if (contentTs && Date.now() - contentTs < CONTENT_DEDUP_WINDOW_MS) {
      return true;
    }
    // Backlog gate — only banner notifications CREATED after the admin
    // opened this dashboard session. Anything older is the backlog and
    // belongs in the bell dropdown, not the top-of-screen banner.
    const createdAt = (n as any).created_at;
    if (createdAt) {
      const ts = new Date(createdAt).getTime();
      if (Number.isFinite(ts) && ts < sessionStartRef.current - 30 * 1000) {
        // 30s grace window so a notification that lands a moment before
        // session start still pops (clock skew / fast-typing admin).
        return true;
      }
    }
    return false;
  };

  const fetchInbox = useCallback(async () => {
    try {
      const res: any = await inboxAPI.unread();
      const list: InboxNotification[] = Array.isArray(res?.notifications) ? res.notifications : [];
      if (list.length === 0) return;
      // Reverse so the OLDEST unread pops first (FIFO).
      const ordered = list.slice().reverse();
      setQueue((prev) => {
        // De-dup against:
        //   1. items already queued (ID match)
        //   2. items the user already dismissed in this session
        //      (ID OR content match — so backend duplicates with
        //      different IDs but identical content also collapse)
        const existing = new Set(prev.map((n) => String(n.id)));
        const existingContent = new Set(prev.map(contentKeyFor));
        const next = ordered.filter((n) => {
          const id = String(n.id);
          if (existing.has(id)) {
            console.log(`[banner] filtered (already queued): ${id}`);
            return false;
          }
          if (existingContent.has(contentKeyFor(n))) {
            console.log(`[banner] filtered (queued duplicate content): ${id}`);
            return false;
          }
          if (isAlreadyHandled(n)) {
            console.log(`[banner] filtered (already handled in this session): ${id}`);
            return false;
          }
          return true;
        });
        if (next.length > 0) {
          console.log(`[banner] queueing ${next.length} new notifications:`, next.map((n) => `${n.id}/${n.type}`));
        } else if (ordered.length > 0) {
          console.log(`[banner] poll returned ${ordered.length} but ALL filtered as duplicates`);
        }
        return [...prev, ...next];
      });
    } catch (e: any) {
      // 401/403 = not authed yet, network = backend asleep — silently retry on next poll.
      console.log('[banner] fetch skipped:', e?.message);
    }
  }, []);

  // Initial fetch + polling cadence.
  useEffect(() => {
    fetchInbox();
    const id = setInterval(fetchInbox, POLL_INTERVAL_MS);
    // Re-poll when window regains focus — admin tab returns to fg.
    const onFocus = () => fetchInbox();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchInbox]);

  // Promote next from queue → current, then animate in.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [head, ...rest] = queue;
    // CRITICAL: mark this notification as READ on the SERVER the
    // moment it's about to display. Was previously only marked at
    // dismiss time — meaning if the user opened the dashboard, saw
    // the banner, then didn't tap, the server kept returning it as
    // unread on every subsequent poll for HOURS. The 8-second auto-
    // dismiss wasn't enough — they could miss the window. Now: the
    // act of being shown counts as "the user has seen this". They
    // can still tap to deep-link or X to acknowledge, but the
    // server-side seen flag is set immediately. Combined with the
    // ID/content/watermark dedup below, this means the banner
    // CAN'T re-show the same notification, ever.
    inboxAPI.markRead(head.id).catch((e) => {
      console.log('[banner] mark-on-show failed (non-fatal):', e?.message);
    });
    rememberDismissed(head);
    console.log(`[banner] showing notification id=${head.id} type=${head.type} title="${head.title}"`);

    setCurrent(head);
    setQueue(rest);
    setDragX(0);
    // Trigger CSS slide-in on next paint.
    requestAnimationFrame(() => setVisible(true));
    // Auto-dismiss after 8s.
    dismissTimerRef.current = setTimeout(() => dismiss(false), 8000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, queue]);

  const dismiss = useCallback(
    (tapped: boolean) => {
      if (!current) return;
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      const dismissing = current;
      // Cement the dismissal (by ID and content key) — already added
      // at promote-time but re-added + persisted defensively here in
      // case a stale closure or race fetched a duplicate while showing.
      rememberDismissed(dismissing);
      setVisible(false);
      setDragX(0);
      // Wait for slide-out animation before unmounting.
      setTimeout(() => setCurrent(null), 220);

      // Mark seen on server (fire-and-forget). The local
      // dismissedIdsRef guard above already protects us if this
      // request is slow / fails — banner stays away regardless.
      inboxAPI.markRead(dismissing.id).catch(() => {});

      // Tap → deep link.
      if (tapped && dismissing.deep_link?.route && onNavigate) {
        const { route, ...params } = dismissing.deep_link;
        onNavigate(route as string, params);
      }
    },
    [current, onNavigate],
  );

  // ─── Drag-to-dismiss ─────────────────────────────────────────────
  // Mouse + touch handlers translate the banner horizontally while
  // the user drags. Past 30% of viewport width, the banner flies off
  // and dismisses; otherwise it snaps back to centre.
  const onPointerDown = (clientX: number): void => {
    dragStartXRef.current = clientX;
    if (dismissTimerRef.current) {
      // Pause the auto-dismiss timer while user is interacting.
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };
  const onPointerMove = (clientX: number): void => {
    if (dragStartXRef.current == null) return;
    setDragX(clientX - dragStartXRef.current);
  };
  const onPointerUp = (): void => {
    if (dragStartXRef.current == null) return;
    dragStartXRef.current = null;
    // Lower threshold (80px absolute) so a short swipe is enough to
    // dismiss. The earlier 30%-of-viewport threshold required dragging
    // ~400px on a desktop monitor — too far, felt unresponsive.
    const threshold = 80;
    if (Math.abs(dragX) > threshold) {
      // Snap off-screen, then dismiss after the animation.
      const direction = dragX > 0 ? 1 : -1;
      setDragX(direction * (typeof window !== 'undefined' ? window.innerWidth : 600));
      setTimeout(() => dismiss(false), 180);
    } else {
      // Spring back.
      setDragX(0);
      // Re-arm the auto-dismiss countdown from scratch.
      dismissTimerRef.current = setTimeout(() => dismiss(false), 8000);
    }
  };

  if (!current) return null;

  // Type → accent colour + icon. Mirrors the RN banner so admin and
  // app users see consistent visual language across surfaces.
  const accent: { bg: string; bar: string; icon: string } = (() => {
    switch (current.type) {
      case 'booking.created':
      case 'booking.assigned':
        return { bg: '#FFFFFF', bar: '#0D3B66', icon: '📋' };
      case 'enquiry.requested':
        return { bg: '#FFFFFF', bar: '#92400E', icon: '📝' };
      case 'quote.sent':
        return { bg: '#FFFFFF', bar: '#0D9488', icon: '💼' };
      default:
        return { bg: '#FFFFFF', bar: '#1F2937', icon: '🔔' };
    }
  })();

  // Fade out as the banner is dragged off — gives a physical sense
  // that swiping dismisses. Past 30% width = fully transparent.
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 600;
  const dragOpacity = Math.max(0, 1 - Math.abs(dragX) / (screenW * 0.5));
  const isDragging = dragStartXRef.current !== null;

  return (
    <div
      style={{
        position: 'fixed',
        top: visible ? 16 : -200,
        left: '50%',
        transform: `translateX(calc(-50% + ${dragX}px))`,
        width: 'min(560px, calc(100vw - 24px))',
        zIndex: 9999,
        opacity: dragOpacity,
        // touch-action: none stops the browser from claiming
        // horizontal touches for pan/scroll, leaving them for our
        // drag handlers. Without this, mobile browsers ate every
        // horizontal swipe.
        touchAction: 'none',
        // Smooth slide on entrance + spring-back, but no transition
        // while the user is actively dragging (would lag the finger).
        transition: isDragging
          ? 'none'
          : 'top 0.32s cubic-bezier(0.34, 1.3, 0.64, 1), transform 0.18s ease-out, opacity 0.18s ease-out',
      }}
      // Pointer events — unified mouse + touch + pen API. Avoids
      // the dual mouse/touch handler dance and works better with
      // touch-action: none.
      onPointerDown={(e) => {
        // Capture the pointer so move/up events fire even if the
        // pointer leaves the element while dragging.
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onPointerDown(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragStartXRef.current !== null) onPointerMove(e.clientX);
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        role="button"
        tabIndex={0}
        // Don't fire the tap-to-deep-link if the user actually
        // dragged — only count it as a tap when the pointer barely
        // moved (within a 5px threshold).
        onClick={() => {
          if (Math.abs(dragX) < 5) dismiss(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') dismiss(true);
        }}
        style={{
          background: accent.bg,
          borderLeft: `4px solid ${accent.bar}`,
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18)',
          cursor: isDragging ? 'grabbing' : 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1 }}>{accent.icon}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: '#0F172A',
              letterSpacing: 0.2,
              marginBottom: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {current.title}
          </div>
          {current.body ? (
            <div
              style={{
                fontSize: 12,
                color: '#475569',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {current.body}
            </div>
          ) : null}
        </div>
        <button
          aria-label="Dismiss notification"
          onClick={(e) => {
            e.stopPropagation();
            dismiss(false);
          }}
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: 0,
            color: '#94A3B8',
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
