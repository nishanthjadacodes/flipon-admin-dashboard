'use client';

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
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

const SECTION_TITLES: Record<SectionId, string> = {
  dashboard: 'Dashboard Overview',
  orders: 'Order Management',
  agents: 'Agent Management',
  services: 'Service Management',
  b2b: 'B2B / Industrial Pipeline',
  vault: 'Document Vault',
  accounts: 'Accounts & Finance',
  reports: 'Reports & Analytics',
  helpdesk: 'Customer Support',
  admin: 'Admin Controls',
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

interface DashboardSummary {
  pendingActions?: number;
  [key: string]: unknown;
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const [notifications, setNotifications] = useState<number>(0);
  const [userRole, setUserRole] = useState<string>('super_admin');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [visited, setVisited] = useState<Partial<Record<SectionId, boolean>>>({ dashboard: true });

  useEffect(() => {
    const checkMobile = (): void => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleSetActive = useCallback(
    (section: string): void => {
      const cap = SECTION_TO_CAP[section as SectionId];
      if (!cap || !can(userRole, cap)) {
        // Silently redirect to the first section this role is allowed into.
        const fallback = firstAllowedSection(userRole) as SectionId;
        setActiveSection(fallback);
        setVisited((prev) => (prev[fallback] ? prev : { ...prev, [fallback]: true }));
        if (isMobile) setIsMobileMenuOpen(false);
        return;
      }
      const sec = section as SectionId;
      setActiveSection(sec);
      setVisited((prev) => (prev[sec] ? prev : { ...prev, [sec]: true }));
      if (isMobile) setIsMobileMenuOpen(false);
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

  // Poll pending-actions count every 60s so the header badge stays fresh.
  useEffect(() => {
    let cancelled = false;
    const pull = async (): Promise<void> => {
      try {
        const s = (await dashboardAPI.getSummary()) as DashboardSummary | null;
        if (!cancelled) setNotifications(Number(s?.pendingActions) || 0);
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

  const title = SECTION_TITLES[activeSection] || 'Admin Panel';

  // Only mount sections the current role is allowed into; that way a lower
  // role's UI never even renders forbidden components.
  const sections = useMemo<SectionEntry[]>(
    () =>
      (
        [
          { id: 'dashboard', cap: CAP.SECTION_DASHBOARD, el: <DashboardOverview notifications={notifications} /> },
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
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
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
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold truncate text-brand">{title}</h1>
                <p className="text-[10px] sm:text-xs text-gray-500 hidden sm:block">
                  FliponeX · India&apos;s Doorstep Digital Service
                </p>
              </div>
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

              <button
                onClick={() => handleSetActive('orders')}
                className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Open pending orders"
                aria-label="Notifications"
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
    </div>
  );
}
