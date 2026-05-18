'use client';

import { useState } from 'react';
import { CAP, can, roleMeta, type Capability } from '@/utils/rbac';

// Menu items gated by capability. The `cap` tells the sidebar whether this
// role is even allowed to see the section. Actual per-button gating lives in
// the respective section components.
interface MenuItem {
  id: string;
  label: string;
  icon: string;
  cap: Capability;
}

const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard Overview', icon: '📊', cap: CAP.SECTION_DASHBOARD },
  { id: 'orders', label: 'Order Management', icon: '📋', cap: CAP.SECTION_ORDERS },
  { id: 'agents', label: 'Representative Management', icon: '👥', cap: CAP.SECTION_AGENTS },
  { id: 'services', label: 'Service Management', icon: '⚙️', cap: CAP.SECTION_SERVICES },
  { id: 'b2b', label: 'B2B Pipeline', icon: '🏭', cap: CAP.SECTION_B2B },
  { id: 'vault', label: 'Document Vault', icon: '🗄️', cap: CAP.SECTION_VAULT },
  { id: 'accounts', label: 'Accounts & Finance', icon: '💰', cap: CAP.SECTION_ACCOUNTS },
  { id: 'helpdesk', label: 'Customer Support', icon: '📞', cap: CAP.SECTION_HELPDESK },
  { id: 'reports', label: 'Reports & Analytics', icon: '📈', cap: CAP.SECTION_REPORTS },
  { id: 'admin', label: 'Admin Controls', icon: '🔐', cap: CAP.SECTION_ADMIN },
  { id: 'flash-notifications', label: 'Flash Notifications', icon: '📣', cap: CAP.SECTION_ADMIN },
];

const ROLE_INITIALS: Record<string, string> = {
  super_admin: 'SA',
  operations_manager: 'OM',
  b2b_admin: 'B2B',
  finance_admin: 'FA',
  customer_support: 'CS',
};

export interface SidebarProps {
  activeSection: string;
  setActiveSection: (id: string) => void;
  notifications: number;
  userRole: string;
  isMobile: boolean;
  onCloseMobileMenu?: () => void;
}

export default function Sidebar({
  activeSection,
  setActiveSection,
  notifications,
  userRole,
  isMobile,
  onCloseMobileMenu,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState<boolean>(false);

  const filteredMenuItems = menuItems.filter((item) => can(userRole, item.cap));
  const meta = roleMeta(userRole);
  const initials = ROLE_INITIALS[userRole] || 'AD';

  // Single logout handler — wipes client state and forwards the
  // user back to the portal page (the toggle screen with the 2
  // apps + 2 websites). Always uses NEXT_PUBLIC_LANDING_URL when
  // set; otherwise falls back to '/' so at least the auth state
  // is cleared. The previous flow used window.confirm which
  // prefixed every prompt with the page URL — replaced by a
  // proper React modal below for a cleaner UX.
  const performLogout = (): void => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage?.clear();
        window.sessionStorage?.clear();
      }
    } catch (_) { /* private mode etc. */ }

    // WebView path — the customer app injects ReactNativeWebView
    // with postMessage so the native side can navigate back to
    // ModeSelectScreen (the toggle page). Works from nested
    // sections too because postMessage doesn't care about the
    // current URL.
    const rnBridge =
      typeof window !== 'undefined' ? (window as any).ReactNativeWebView : null;
    if (rnBridge?.postMessage) {
      rnBridge.postMessage('LOGOUT');
      return;
    }

    // Browser path — env var if set, otherwise '/'. Use
    // window.location.assign for an absolute navigation so
    // nested-section hash routes don't interfere.
    const target =
      (process.env.NEXT_PUBLIC_LANDING_URL as string | undefined) || '/';
    if (typeof window !== 'undefined') {
      window.location.assign(target);
    }
  };

  return (
    <aside
      style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-primary-contrast)' }}
      className={`${isCollapsed && !isMobile ? 'w-20' : 'w-64'} transition-all duration-200 ease-out flex flex-col ${isMobile ? 'h-full' : ''}`}
    >
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fliponex-logo.jpeg"
              alt="FliponeX"
              className="w-10 h-10 rounded-full shrink-0 bg-white/5 glow-yellow"
            />
            {!(isCollapsed && !isMobile) && (
              <div className="min-w-0">
                <h2 className="font-bold text-lg leading-tight truncate">FliponeX</h2>
                <p className="text-[10px] uppercase tracking-widest text-white/70">Admin Console</p>
              </div>
            )}
          </div>
          {!isMobile && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 rounded hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40 shrink-0"
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? '→' : '←'}
            </button>
          )}
          {isMobile && (
            <button
              onClick={onCloseMobileMenu}
              className="p-2 rounded hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        <ul className="space-y-1">
          {filteredMenuItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveSection(item.id)}
                  title={isCollapsed && !isMobile ? item.label : undefined}
                  style={
                    isActive
                      ? {
                          backgroundColor: 'rgba(255,255,255,0.12)',
                          color: '#fff',
                          borderLeft: '4px solid var(--brand-sun)',
                          paddingLeft: '0.5rem',
                        }
                      : undefined
                  }
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors duration-100 ${
                    isActive ? 'shadow-inner font-semibold' : 'hover:bg-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  <span className="text-lg flex-shrink-0">{item.icon}</span>
                  {!(isCollapsed && !isMobile) && (
                    <>
                      <span className="flex-1 text-left text-sm">{item.label}</span>
                      {item.id === 'orders' && notifications > 0 && (
                        <span
                          style={{ backgroundColor: 'var(--brand-flag)' }}
                          className="text-white text-xs rounded-full px-2 py-0.5 font-semibold"
                        >
                          {notifications}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-white/10 space-y-3">
        <div className={`flex items-center ${isCollapsed && !isMobile ? 'justify-center' : 'space-x-3'}`}>
          <div
            style={{ backgroundColor: 'var(--brand-sun)', color: 'var(--brand-primary)' }}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          >
            <span className="text-xs font-bold">{initials}</span>
          </div>
          {!(isCollapsed && !isMobile) && (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Admin User</p>
              <p className="text-xs text-white/70 truncate">{meta.label}</p>
              {meta.target && <p className="text-[10px] text-white/50 truncate">{meta.target}</p>}
            </div>
          )}
        </div>

        {/* Logout — opens a custom React modal (NOT window.confirm,
            which prefixes every prompt with "The page at https://…
            says"). Modal calls performLogout() on OK; performLogout
            forwards via WebView postMessage when embedded in the
            customer app, else does an absolute window.location.assign
            to NEXT_PUBLIC_LANDING_URL or '/'. Works from nested
            section URLs because we don't rely on the current hash. */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          title={isCollapsed && !isMobile ? 'Logout' : undefined}
          className={`w-full flex items-center ${
            isCollapsed && !isMobile ? 'justify-center' : 'justify-center gap-2'
          } px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors`}
          aria-label="Logout"
        >
          <span className="text-base">⎋</span>
          {!(isCollapsed && !isMobile) && <span>Logout</span>}
        </button>
      </div>

      {/* Logout confirmation — custom modal so we never get the
          browser-prefixed "The page at https://… says" header that
          window.confirm renders by default. z-index 60 keeps it
          above the section content (the sidebar itself is z-40). */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
          >
            <div className="text-3xl mb-2">⎋</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Do you want to logout?
            </h3>
            <p className="text-sm text-gray-500 mb-5">
              You&apos;ll be returned to the portal page.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutConfirm(false);
                  performLogout();
                }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
                autoFocus
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
