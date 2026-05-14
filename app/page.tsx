'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import Sidebar from '@/components/Sidebar';
import DashboardOverview from '@/components/DashboardOverview';
import OrderManagement from '@/components/OrderManagement';
import AgentManagement from '@/components/AgentManagement';
import ServiceManagement from '@/components/ServiceManagement';
import Reports from '@/components/Reports';
import AdminControls from '@/components/AdminControls';
import Helpdesk from '@/components/Helpdesk';
import B2BPipeline from '@/components/B2BPipeline';
import DocumentVault from '@/components/DocumentVault';
import Accounts from '@/components/Accounts';
import NotificationBanner from '@/components/NotificationBanner';
import { dashboardAPI } from '@/utils/api';
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
  | 'admin';

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

interface PendingDocItem {
  id: string;
  status?: string;
  service?: { name?: string };
  agent?: { name?: string };
  customer?: { name?: string };
  created_at?: string;
}

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
  const [bellItems, setBellItems] = useState<PendingDocItem[]>([]);
  const [bellLoading, setBellLoading] = useState<boolean>(false);
  // Booking IDs the admin has already seen in the bell dropdown. Stored
  // in localStorage so the badge count stays decremented across page
  // reloads. Background poll subtracts these from the pending count;
  // when a NEW pending booking shows up (different id), it bumps the
  // badge back up. Without this filter the badge kept showing the full
  // backlog forever even though the admin had viewed the items.
  const [seenBookingIds, setSeenBookingIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('admin_bell_seen_ids_v1');
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const persistSeen = (next: Set<string>): void => {
    try {
      // Cap at 500 IDs so localStorage doesn't grow unbounded — the
      // oldest entries are silently dropped on overflow.
      const arr = Array.from(next).slice(-500);
      localStorage.setItem('admin_bell_seen_ids_v1', JSON.stringify(arr));
    } catch {
      /* quota exceeded — ignore */
    }
  };

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
      const detail = (e as CustomEvent<{ section?: string }>).detail;
      const section = detail?.section;
      if (section) handleSetActive(section);
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

  // Poll the header badge count every 60s. Two-stage filter:
  //   1. The first time the dashboard mounts in this session, we
  //      auto-seed ALL currently-pending booking IDs into seenBookingIds.
  //      This treats the existing backlog as "already seen" so the badge
  //      shows 0 on a fresh dashboard open — admins were seeing badge=33
  //      every time they opened the page despite no new orders coming
  //      in, because the backlog persisted forever.
  //   2. Subsequent polls only bump the badge for booking IDs that
  //      AREN'T already in the seen set — i.e. genuinely new orders.
  // Net: badge = "new orders since I opened the dashboard", not
  // "everything in the pending queue".
  const didSeedRef = useRef<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    const pull = async (): Promise<void> => {
      try {
        const data = await dashboardAPI.getPendingDocumentation();
        const list = Array.isArray(data) ? (data as PendingDocItem[]) : [];
        if (cancelled) return;

        if (!didSeedRef.current) {
          // First poll of this dashboard session — silently mark every
          // current pending booking as "already seen" so the backlog
          // doesn't spam the badge. New bookings created AFTER this
          // moment will pass the filter and bump the count.
          didSeedRef.current = true;
          setSeenBookingIds((prev) => {
            const next2 = new Set(prev);
            list.forEach((b) => next2.add(String(b.id)));
            persistSeen(next2);
            return next2;
          });
          setNotifications(0);
          return;
        }

        const unseen = list.filter((b) => !seenBookingIds.has(String(b.id)));
        setNotifications(unseen.length);
      } catch {
        // leave existing value
      }
    };
    pull();
    const t = setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [seenBookingIds]);

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

            <div className="flex items-center gap-2 sm:gap-3">
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                title="Preview the panel as a different role (RBAC simulation)"
                className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>

              {/* Bell + dropdown — click toggles a small notification panel
                  showing the actual list of pending bookings (so the admin
                  doesn't blindly land on the orders tab; they can pick a
                  specific booking to action). Click outside / on backdrop
                  closes the panel. Bell is keyboard-accessible. */}
              <div className="relative">
                <button
                  onClick={async () => {
                    const next = !bellOpen;
                    setBellOpen(next);
                    if (next) {
                      // Fetch fresh list each time the dropdown opens.
                      // 60-second poll keeps the badge count live but the
                      // bookings list could be stale, so refetch on open.
                      setBellLoading(true);
                      try {
                        const data = await dashboardAPI.getPendingDocumentation();
                        const items = Array.isArray(data) ? (data as PendingDocItem[]) : [];
                        setBellItems(items);
                        // Mark every booking the admin is now seeing as
                        // "seen". Clear the badge immediately; future
                        // polls will only re-add IDs that show up for
                        // the first time (new bookings).
                        setSeenBookingIds((prev) => {
                          const next2 = new Set(prev);
                          items.forEach((it) => next2.add(String(it.id)));
                          persistSeen(next2);
                          return next2;
                        });
                        setNotifications(0);
                      } catch {
                        setBellItems([]);
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
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
                        <span className="text-xs text-gray-500">
                          {bellItems.length} pending
                        </span>
                      </div>

                      <div className="max-h-80 overflow-y-auto">
                        {bellLoading ? (
                          <div className="p-6 text-center text-sm text-gray-500">
                            Loading…
                          </div>
                        ) : bellItems.length === 0 ? (
                          <div className="p-6 text-center text-sm text-gray-500">
                            🎉 All caught up — no pending actions.
                          </div>
                        ) : (
                          bellItems.slice(0, 8).map((b) => (
                            <button
                              key={b.id}
                              onClick={() => {
                                setBellOpen(false);
                                window.dispatchEvent(
                                  new CustomEvent('admin:navigate', {
                                    detail: { section: 'orders', orderId: b.id },
                                  }),
                                );
                              }}
                              className="w-full text-left px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    {b.service?.name || 'Service booking'}
                                  </p>
                                  <p className="text-xs text-gray-600 truncate mt-0.5">
                                    {b.customer?.name || 'Customer'}
                                    {b.agent?.name ? ` · Rep: ${b.agent.name}` : ' · Unassigned'}
                                  </p>
                                </div>
                                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 text-yellow-800 capitalize">
                                  {(b.status || 'pending').replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-400 mt-1 font-mono">
                                #{String(b.id).slice(0, 8)}
                              </p>
                            </button>
                          ))
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
