'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import Sidebar from '@/components/Sidebar';
import DashboardOverview from '@/components/DashboardOverview';
import OrderManagement from '@/components/OrderManagement';
import AgentManagement from '@/components/AgentManagement';
import ServiceManagement from '@/components/ServiceManagement';
import Reports from '@/components/Reports';
import AdminControls from '@/components/AdminControls';
import FlashNotifications from '@/components/FlashNotifications';
import Helpdesk from '@/components/Helpdesk';
import B2BPipeline from '@/components/B2BPipeline';
import DocumentVault from '@/components/DocumentVault';
import Accounts from '@/components/Accounts';
import NotificationBanner from '@/components/NotificationBanner';
import { inboxAPI } from '@/utils/api';
import { CAP, can, firstAllowedSection, ROLE_LIST, roleMeta, type Capability } from '@/utils/rbac';

type SectionId =
  | 'dashboard'
  | 'orders'
  | 'agents'
  | 'services'
  | 'b2b'
  | 'vault'
  | 'accounts'
  | 'helpdesk'
  | 'reports'
  | 'admin'
  | 'flash-notifications';

const SECTION_TO_CAP: Record<SectionId, Capability> = {
  dashboard: CAP.SECTION_DASHBOARD,
  orders: CAP.SECTION_ORDERS,
  agents: CAP.SECTION_AGENTS,
  services: CAP.SECTION_SERVICES,
  b2b: CAP.SECTION_B2B,
  vault: CAP.SECTION_VAULT,
  accounts: CAP.SECTION_ACCOUNTS,
  helpdesk: CAP.SECTION_HELPDESK,
  reports: CAP.SECTION_REPORTS,
  admin: CAP.SECTION_ADMIN,
  'flash-notifications': CAP.SECTION_ADMIN,
};

interface RoleOption {
  id: string;
  label: string;
}

const ROLE_OPTIONS: RoleOption[] = ROLE_LIST.map((r) => ({ id: r, label: roleMeta(r).label }));

interface SectionEntry {
  id: SectionId;
  cap: Capability;
  el: ReactElement;
}

// One row from /notifications/inbox — drives the header bell dropdown.
interface BellNotification {
  id: string | number;
  type: string;
  title: string;
  body?: string | null;
  deep_link?: { route?: string; bookingId?: string; enquiryId?: string } | null;
  seen_at?: string | null;
  created_at?: string;
}

// Collapse duplicate notifications for the bell dropdown. The backend
// can write several rows with identical content for one real event —
// the customer app retrying a booking POST creates multiple bookings,
// and the booking-created fan-out adds a row per admin. They all share
// the same type|title|body, so without this the bell shows e.g.
// "Mohammed requested Aadhaar DOB update" three times. Keep only the
// newest of each content group (the inbox API returns newest-first) —
// the same content-key dedup the top-down NotificationBanner uses.
const dedupeNotifications = (list: BellNotification[]): BellNotification[] => {
  const seen = new Set<string>();
  const out: BellNotification[] = [];
  for (const n of list) {
    const key = `${n.type}|${n.title}|${n.body || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
};

// Type → emoji for the bell dropdown rows. Mirrors the top-down banner.
const NOTIF_ICON: Record<string, string> = {
  'booking.created': '📋',
  'booking.assigned': '📋',
  'enquiry.requested': '📝',
  'quote.sent': '💼',
};

// Compact "time ago" label for bell rows — "just now", "5m ago", "3h ago".
const timeAgo = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function Home() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const [notifications, setNotifications] = useState<number>(0);
  const [userRole, setUserRole] = useState<string>('super_admin');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [visited, setVisited] = useState<Partial<Record<SectionId, boolean>>>({ dashboard: true });
  // Notification dropdown — opens when the bell is clicked. Shows the
  // real list of pending actions so the admin can dive straight into a
  // specific booking instead of just landing on the orders tab.
  const [bellOpen, setBellOpen] = useState<boolean>(false);
  const [bellItems, setBellItems] = useState<BellNotification[]>([]);
  const [bellLoading, setBellLoading] = useState<boolean>(false);
  // High-water mark — the timestamp the bell was last opened. The badge
  // counts ONLY notifications created AFTER this, so once the admin
  // opens the bell every older notification is acknowledged for good:
  // the count can never resurrect (a later poll, a failed mark-read, or
  // a duplicate row cannot bring an old one back). Persisted so it
  // survives reloads; a ref so the 60s poll closure reads the latest.
  const bellSeenAtRef = useRef<number>(
    (() => {
      if (typeof window === 'undefined') return 0;
      try {
        return Number(localStorage.getItem('flipone_admin_bell_seen_at')) || 0;
      } catch {
        return 0;
      }
    })(),
  );

  useEffect(() => {
    const checkMobile = (): void => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── URL-hash history tracking ────────────────────────────────────
  // The dashboard is a single Next.js page that swaps sections via
  // setActiveSection. Without explicit history management, the
  // browser back button takes the user OUT of the dashboard entirely
  // (e.g. back to the previous tab / login). This wires each section
  // change to push a hash entry (`#dashboard`, `#orders`, etc.), and
  // a popstate listener walks the chain in reverse on browser back.
  //
  // Skip-back guard: the FIRST setActiveSection that fires from a
  // popstate event must NOT itself push a new history entry —
  // otherwise back→forward→back would loop forever. Tracked via
  // `historyDrivenRef`.
  const historyDrivenRef = useRef<boolean>(false);

  const handleSetActive = useCallback(
    (section: string): void => {
      const cap = SECTION_TO_CAP[section as SectionId];
      if (!cap || !can(userRole, cap)) {
        // Silently redirect to the first section this role is allowed into.
        const fallback = firstAllowedSection(userRole) as SectionId;
        setActiveSection(fallback);
        setVisited((prev) => (prev[fallback] ? prev : { ...prev, [fallback]: true }));
        if (isMobile) setIsMobileMenuOpen(false);
        // Push hash for the fallback so back can reach it.
        if (!historyDrivenRef.current && typeof window !== 'undefined') {
          window.history.pushState({ section: fallback }, '', `#${fallback}`);
        }
        return;
      }
      const sec = section as SectionId;
      setActiveSection(sec);
      setVisited((prev) => (prev[sec] ? prev : { ...prev, [sec]: true }));
      if (isMobile) setIsMobileMenuOpen(false);
      // Push a history entry so browser back returns to the previous
      // section. If this call was triggered by popstate itself, skip
      // the push — the URL is already the right one.
      if (!historyDrivenRef.current && typeof window !== 'undefined') {
        const currentHash = window.location.hash.replace(/^#/, '');
        if (currentHash !== sec) {
          window.history.pushState({ section: sec }, '', `#${sec}`);
        }
      }
    },
    [isMobile, userRole],
  );

  useEffect(() => {
    const handleNavigate = (e: Event): void => {
      const detail = (e as CustomEvent<{ section?: string; orderId?: string }>)
        .detail;
      const section = detail?.section;
      if (!section) return;
      handleSetActive(section);
      // A notification about a specific booking carries an orderId.
      // Rewrite the hash to #orders/<id> AFTER handleSetActive (which
      // sets a bare #orders) so OrderManagement opens that order's
      // detail panel when it mounts — AND fire admin:open-order so it
      // also opens when Order Management is ALREADY on screen (the
      // hash mount-effect only runs on a fresh mount).
      if (section === 'orders' && detail?.orderId && typeof window !== 'undefined') {
        window.history.replaceState(
          { section: 'orders', orderId: detail.orderId },
          '',
          `#orders/${detail.orderId}`,
        );
        window.dispatchEvent(
          new CustomEvent('admin:open-order', {
            detail: { orderId: detail.orderId },
          }),
        );
      }
    };
    window.addEventListener('admin:navigate', handleNavigate);
    return () => window.removeEventListener('admin:navigate', handleNavigate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser back/forward → restore section from URL hash. The
  // historyDrivenRef flag ensures handleSetActive doesn't push another
  // entry on top while we're consuming an existing one.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    // Seed the URL on first mount so a back from the dashboard's
    // initial section reliably has an entry to land on.
    if (!window.location.hash) {
      window.history.replaceState({ section: activeSection }, '', `#${activeSection}`);
    }

    const onPop = (e: PopStateEvent): void => {
      const targetSection =
        (e.state && (e.state as { section?: string }).section) ||
        window.location.hash.replace(/^#/, '') ||
        'dashboard';
      historyDrivenRef.current = true;
      handleSetActive(targetSection);
      // Reset the flag on next tick so subsequent user-initiated
      // section changes still push history entries normally.
      setTimeout(() => { historyDrivenRef.current = false; }, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Header-bell notifications ────────────────────────────────────
  // The badge + dropdown are driven by the in-app inbox
  // (/notifications/inbox) — the SAME source the top-down banner uses.
  // The backend writes a `booking.created` row for every admin the
  // moment a customer books, so a new order lights the bell badge
  // within one poll cycle. `unread_count` is the badge; the
  // notifications list (read + unread, newest first) is the dropdown.
  // Polls every 60s and whenever the window regains focus.
  useEffect(() => {
    let cancelled = false;
    const pull = async (): Promise<void> => {
      try {
        const res = await inboxAPI.list();
        if (cancelled) return;
        const list = dedupeNotifications(
          Array.isArray(res?.notifications)
            ? (res.notifications as BellNotification[])
            : [],
        );
        setBellItems(list);
        // Badge = notifications created AFTER the bell was last opened
        // (the high-water mark). Anything older was acknowledged when the
        // admin opened the bell, so it can NEVER count again — the badge
        // can't resurrect on a later poll, a failed mark-read, or a dupe.
        setNotifications(
          list.filter((n) => {
            const t = n.created_at ? new Date(n.created_at).getTime() : 0;
            return Number.isFinite(t) && t > bellSeenAtRef.current;
          }).length,
        );
      } catch {
        // backend asleep / not authed yet — keep last good values
      }
    };
    pull();
    const t = setInterval(pull, 60_000);
    const onFocus = (): void => { void pull(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // When the role changes, send the user away from any section they can no
  // longer see. Also reset visited tabs so forbidden sections aren't kept in
  // the DOM (prevents their data from flashing when the role switches back).
  useEffect(() => {
    const cap = SECTION_TO_CAP[activeSection];
    if (!cap || !can(userRole, cap)) {
      const fallback = firstAllowedSection(userRole) as SectionId;
      setActiveSection(fallback);
      setVisited({ [fallback]: true });
    } else {
      setVisited((prev) => {
        const next: Partial<Record<SectionId, boolean>> = {};
        (Object.keys(prev) as SectionId[]).forEach((k) => {
          if (can(userRole, SECTION_TO_CAP[k])) next[k] = true;
        });
        next[activeSection] = true;
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  // Only mount sections the current role is allowed into; that way a lower
  // role's UI never even renders forbidden components.
  const sections = useMemo<SectionEntry[]>(
    () =>
      (
        [
          { id: 'dashboard', cap: CAP.SECTION_DASHBOARD, el: <DashboardOverview notifications={notifications} userRole={userRole} /> },
          { id: 'orders', cap: CAP.SECTION_ORDERS, el: <OrderManagement userRole={userRole} /> },
          { id: 'agents', cap: CAP.SECTION_AGENTS, el: <AgentManagement userRole={userRole} /> },
          { id: 'services', cap: CAP.SECTION_SERVICES, el: <ServiceManagement userRole={userRole} /> },
          { id: 'b2b', cap: CAP.SECTION_B2B, el: <B2BPipeline userRole={userRole} /> },
          { id: 'vault', cap: CAP.SECTION_VAULT, el: <DocumentVault userRole={userRole} /> },
          { id: 'accounts', cap: CAP.SECTION_ACCOUNTS, el: <Accounts userRole={userRole} /> },
          { id: 'reports', cap: CAP.SECTION_REPORTS, el: <Reports userRole={userRole} /> },
          { id: 'helpdesk', cap: CAP.SECTION_HELPDESK, el: <Helpdesk userRole={userRole} /> },
          { id: 'admin', cap: CAP.SECTION_ADMIN, el: <AdminControls userRole={userRole} /> },
          { id: 'flash-notifications', cap: CAP.SECTION_ADMIN, el: <FlashNotifications userRole={userRole} /> },
        ] as SectionEntry[]
      ).filter((s) => can(userRole, s.cap)),
    [notifications, userRole],
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {isMobile && isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <div
        className={`${isMobile ? 'fixed inset-y-0 left-0 z-50' : 'relative'} ${
          isMobile && !isMobileMenuOpen ? '-translate-x-full' : ''
        } transition-transform duration-200 ease-out`}
      >
        <Sidebar
          activeSection={activeSection}
          setActiveSection={handleSetActive}
          notifications={notifications}
          userRole={userRole}
          isMobile={isMobile}
          onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        />
      </div>

      <main className="flex-1 overflow-y-auto">
        {/* Thin Prussian-blue strip — brand accent that's always visible at the top of the content area. */}
        <div
          style={{
            background:
              'linear-gradient(90deg, var(--brand-primary) 0%, var(--brand-banner) 55%, var(--brand-primary) 100%)',
          }}
          className="h-1 w-full"
        />
        <header
          style={{ borderBottomColor: 'var(--brand-primary)' }}
          className="bg-white shadow-sm border-b-2 sticky top-0 z-30"
        >
          <div className="px-4 sm:px-6 py-3 flex justify-between items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {isMobile && (
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 ring-brand"
                  aria-label="Open menu"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
              {isMobile && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src="/fliponex-logo.jpeg" alt="FliponeX" className="w-7 h-7 rounded-full" />
              )}
              {/* Top-bar title + subtitle removed — the section is
                  already visible in the sidebar; doubling it up here
                  was just visual noise and on smaller screens the
                  truncated title looked like stray characters ("D…",
                  "O…", "A…"). Empty spacer keeps the flex layout
                  balanced so the bell + role selector stay right-
                  aligned. */}
              <div className="min-w-0" />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-1">
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                title="Preview the panel as a different role (RBAC simulation)"
                className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 flex-1 min-w-[120px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>

              {/* Bell + dropdown — the badge and list are driven by the
                  in-app notification inbox. A new customer booking writes
                  a `booking.created` row for every admin, so it lights the
                  badge here and shows in the dropdown. Tap a row to mark it
                  read and jump to the relevant section; click outside to
                  close. Bell is keyboard-accessible. */}
              <div className="relative">
                <button
                  onClick={async () => {
                    const next = !bellOpen;
                    setBellOpen(next);
                    if (next) {
                      // Refetch on open so the list is fresh — the 60s
                      // poll keeps the badge live but the list could be
                      // up to a minute stale.
                      setBellLoading(true);
                      try {
                        const res = await inboxAPI.list();
                        const list = dedupeNotifications(
                          Array.isArray(res?.notifications)
                            ? (res.notifications as BellNotification[])
                            : [],
                        );
                        // Opening the bell counts as the admin having SEEN
                        // every notification — mark them all read server-
                        // side and clear the badge. This is what stops the
                        // count resurrecting after the admin taps a
                        // notification, navigates away and comes back:
                        // nothing is left unread for a later poll to
                        // re-count. (Per-row markRead couldn't do this —
                        // the dedup hides the duplicate rows, so their ids
                        // aren't available to mark individually.)
                        // Advance the high-water mark — every current
                        // notification is now acknowledged; only ones
                        // created AFTER this moment count again, so the
                        // badge can never climb back to an old value.
                        const seenAt = Date.now();
                        bellSeenAtRef.current = seenAt;
                        try {
                          localStorage.setItem(
                            'flipone_admin_bell_seen_at',
                            String(seenAt),
                          );
                        } catch {
                          /* private mode / quota — in-memory ref still holds */
                        }
                        const hadUnread = list.some((n) => !n.seen_at);
                        const nowIso = new Date().toISOString();
                        setBellItems(
                          list.map((n) => ({ ...n, seen_at: n.seen_at || nowIso })),
                        );
                        setNotifications(0);
                        if (hadUnread) {
                          inboxAPI.markAllRead().catch(() => {});
                        }
                      } catch {
                        /* keep whatever the background poll last loaded */
                      } finally {
                        setBellLoading(false);
                      }
                    }
                  }}
                  className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title="Open notifications"
                  aria-label="Notifications"
                  aria-expanded={bellOpen}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {notifications > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center font-semibold">
                      {notifications > 99 ? '99+' : notifications}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <>
                    {/* Click-outside backdrop — invisible full-screen
                        layer that closes the dropdown when clicked. */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setBellOpen(false)}
                    />
                    <div
                      className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-gray-200 rounded-lg shadow-xl z-50"
                      role="menu"
                    >
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
                        {notifications > 0 ? (
                          <button
                            onClick={async () => {
                              // Optimistically clear locally, then persist.
                              setBellItems((prev) =>
                                prev.map((it) => ({
                                  ...it,
                                  seen_at: it.seen_at || new Date().toISOString(),
                                })),
                              );
                              setNotifications(0);
                              try {
                                await inboxAPI.markAllRead();
                              } catch {
                                /* badge already cleared locally */
                              }
                            }}
                            className="text-xs font-semibold text-blue-600 hover:underline"
                          >
                            Mark all read
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">All read</span>
                        )}
                      </div>

                      <div className="max-h-80 overflow-y-auto">
                        {bellLoading ? (
                          <div className="p-6 text-center text-sm text-gray-500">
                            Loading…
                          </div>
                        ) : bellItems.length === 0 ? (
                          <div className="p-6 text-center text-sm text-gray-500">
                            🎉 All caught up — no notifications.
                          </div>
                        ) : (
                          bellItems.slice(0, 12).map((n) => {
                            const unread = !n.seen_at;
                            return (
                              <button
                                key={n.id}
                                onClick={async () => {
                                  setBellOpen(false);
                                  if (unread) {
                                    setBellItems((prev) =>
                                      prev.map((it) =>
                                        it.id === n.id
                                          ? { ...it, seen_at: new Date().toISOString() }
                                          : it,
                                      ),
                                    );
                                    setNotifications((c) => Math.max(0, c - 1));
                                    try {
                                      await inboxAPI.markRead(n.id);
                                    } catch {
                                      /* local state already updated */
                                    }
                                  }
                                  const route = n.deep_link?.route;
                                  if (route) {
                                    window.dispatchEvent(
                                      new CustomEvent('admin:navigate', {
                                        detail: {
                                          section: route,
                                          orderId: n.deep_link?.bookingId,
                                          enquiryId: n.deep_link?.enquiryId,
                                        },
                                      }),
                                    );
                                  }
                                }}
                                className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors ${
                                  unread ? 'bg-blue-50/50' : ''
                                }`}
                              >
                                <div className="flex items-start gap-2.5">
                                  <span className="text-lg leading-none mt-0.5">
                                    {NOTIF_ICON[n.type] || '🔔'}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {n.title}
                                    </p>
                                    {n.body ? (
                                      <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                                        {n.body}
                                      </p>
                                    ) : null}
                                    <p className="text-[11px] text-gray-400 mt-1">
                                      {timeAgo(n.created_at)}
                                    </p>
                                  </div>
                                  {unread && (
                                    <span className="shrink-0 w-2 h-2 rounded-full bg-red-500 mt-1.5" />
                                  )}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>

                      {bellItems.length > 0 && (
                        <button
                          onClick={() => {
                            setBellOpen(false);
                            handleSetActive('orders');
                          }}
                          className="w-full px-4 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 border-t border-gray-100"
                        >
                          View all in Order Management →
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6">
          {/* Keep every visited section mounted so flipping tabs is instant; the
              API cache layer prevents re-fetching the same data across switches. */}
          {sections.map((s) => {
            const isActive = activeSection === s.id;
            if (!visited[s.id] && !isActive) return null;
            return (
              <div key={s.id} className={isActive ? 'block fade-in-scale' : 'hidden'}>
                {s.el}
              </div>
            );
          })}
        </div>
      </main>

      {/* Top-down notification banner. Polls /notifications/inbox?unread_only=true
          on mount + every 30s, slides in from the top of the screen for each
          unseen item, and routes the admin to the relevant section on tap.
          deep_link.route maps directly to our SectionId values
          (e.g. 'orders', 'b2b'), so we feed it through handleSetActive. */}
      <NotificationBanner
        onNavigate={(route) => {
          if (route === 'orders' || route === 'b2b' || route === 'agents' ||
              route === 'services' || route === 'vault' || route === 'accounts' ||
              route === 'helpdesk' || route === 'reports' || route === 'admin' ||
              route === 'dashboard') {
            handleSetActive(route as SectionId);
          }
        }}
      />
    </div>
  );
}
