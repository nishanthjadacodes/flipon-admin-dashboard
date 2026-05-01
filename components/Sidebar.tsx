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

  const filteredMenuItems = menuItems.filter((item) => can(userRole, item.cap));
  const meta = roleMeta(userRole);
  const initials = ROLE_INITIALS[userRole] || 'AD';

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

      <div className="p-4 border-t border-white/10">
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
      </div>
    </aside>
  );
}
