'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { dashboardAPI, agentsAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';

type StatusKey =
  | 'completed'
  | 'in_progress'
  | 'in-progress'
  | 'assigned'
  | 'accepted'
  | 'pending'
  | 'cancelled';

const statusTone: Record<StatusKey, string> = {
  completed: 'bg-green-100 text-green-800',
  in_progress: 'bg-blue-100 text-blue-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  accepted: 'bg-indigo-100 text-indigo-800',
  pending: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-red-100 text-red-800',
};

const money = (n: unknown): string =>
  typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—';

type Accent = 'b' | 'y' | 'r' | 'g' | 't';

interface MetricCardProps {
  title: string;
  value: string | number;
  trend?: number;
  hint?: string;
  icon: string;
  accent?: Accent;
  onClick?: () => void;
}

function MetricCard({ title, value, trend, hint, icon, accent = 'b', onClick }: MetricCardProps) {
  // Accent legend: b = banner-blue (default primary KPI),
  //                y = sun-yellow, r = flag-red, g = gold, t = teal
  const iconBg =
    ({
      b: { background: 'var(--brand-banner-soft)', color: 'var(--brand-banner)' },
      y: { background: 'var(--brand-sun-soft)', color: '#8c6a00' },
      r: { background: 'var(--brand-flag-soft)', color: 'var(--brand-flag)' },
      g: { background: 'var(--brand-gold-soft)', color: 'var(--brand-gold)' },
      t: { background: 'var(--brand-teal-soft)', color: 'var(--brand-teal)' },
    } as Record<Accent, { background: string; color: string }>)[accent] || {
      background: 'var(--brand-banner-soft)',
      color: 'var(--brand-banner)',
    };

  const trendPos = (trend ?? 0) >= 0;
  const clickable = typeof onClick === 'function';
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`tile lift accent-${accent} ${clickable ? 'cursor-pointer transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1 leading-tight">{value}</p>
          {trend !== undefined && trend !== null && (
            <span
              className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{
                background: trendPos ? 'var(--brand-teal-soft)' : 'var(--brand-flag-soft)',
                color: trendPos ? 'var(--brand-teal)' : 'var(--brand-flag)',
              }}
            >
              {trendPos ? '▲' : '▼'} {Math.abs(trend)}% vs previous
            </span>
          )}
          {hint && <p className="text-xs text-gray-500 mt-2">{hint}</p>}
        </div>
        <div
          className="text-2xl w-12 h-12 rounded-xl flex items-center justify-center float-y shrink-0"
          style={iconBg}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

// Fire the `admin:navigate` event listened for in app/page.tsx — lets children
// jump to other sections without prop-drilling a setter through every layer.
const navigateToSection = (section: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('admin:navigate', { detail: { section } }));
};

interface AlertRecord {
  id: string;
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
}

function AlertItem({ alert }: { alert: AlertRecord }) {
  const tone =
    ({
      error: 'bg-red-50 border-red-200 text-red-800',
      warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      info: 'bg-blue-50 border-blue-200 text-blue-800',
    } as Record<AlertRecord['type'], string>)[alert.type] ||
    'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`p-3 rounded-lg border ${tone}`}>
      <div className="flex justify-between items-start">
        <p className="text-sm font-medium">{alert.message}</p>
        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{alert.category}</span>
      </div>
    </div>
  );
}

interface PendingAction {
  id: string;
  type: 'verify_booking' | 'review_agent' | string;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

function PendingActionRow({ action, onAct }: { action: PendingAction; onAct: (a: PendingAction) => void }) {
  const severityTone: Record<PendingAction['severity'], string> = {
    high: 'bg-red-100 text-red-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-gray-100 text-gray-700',
  };
  return (
    <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{action.title}</p>
        <p className="text-xs text-gray-600 truncate">{action.description}</p>
      </div>
      <div className="flex items-center space-x-2 ml-3">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            severityTone[action.severity] || severityTone.low
          }`}
        >
          {action.severity}
        </span>
        <button
          onClick={() => onAct(action)}
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
        >
          Resolve
        </button>
      </div>
    </div>
  );
}

interface AgentRecord {
  id: string;
  name: string;
  rating?: number;
  total_jobs_completed?: number;
  online_status?: boolean;
}

interface BookingRecord {
  id: string;
  status?: string;
  booking_type?: 'consumer' | 'industrial' | string;
  service?: { name?: string; service_type?: 'consumer' | 'industrial' | string };
  customer?: { name?: string };
  final_price?: number;
  price_quoted?: number;
  amount?: number;
}

interface DashboardSummary {
  bookings?: { today?: number; yesterday?: number; deltaPct?: number };
  agents?: { active?: number; total?: number };
  revenue?: { thisMonth?: number; lastMonth?: number; deltaPct?: number };
  pendingActions?: number;
}

function deriveAlerts({
  agents,
  pendingDocs,
  summary,
}: {
  agents?: AgentRecord[];
  pendingDocs?: BookingRecord[];
  summary?: DashboardSummary | null;
}): AlertRecord[] {
  const alerts: AlertRecord[] = [];
  for (const a of agents || []) {
    const jobs = a.total_jobs_completed ?? 0;
    if ((a.rating ?? 5) < 4.0) {
      alerts.push({
        id: `agent-rating-${a.id}`,
        type: 'warning',
        category: 'agent-performance',
        message: `${a.name} rating ${a.rating} — below 4.0 threshold (${jobs} jobs)`,
      });
    }
  }
  const pendingCount = (pendingDocs || []).length;
  if (pendingCount > 0) {
    alerts.push({
      id: 'docs-pending',
      type: 'info',
      category: 'documentation',
      message: `${pendingCount} booking${pendingCount === 1 ? '' : 's'} awaiting documentation review`,
    });
  }
  if ((summary?.pendingActions ?? 0) > 10) {
    alerts.push({
      id: 'ops-backlog',
      type: 'error',
      category: 'operations',
      message: `Backlog growing — ${summary!.pendingActions} pending actions require attention`,
    });
  }
  return alerts;
}

function derivePendingActions({
  pendingDocs,
  agents,
}: {
  pendingDocs?: BookingRecord[];
  agents?: AgentRecord[];
}): PendingAction[] {
  const actions: PendingAction[] = [];
  for (const b of pendingDocs || []) {
    actions.push({
      id: `verify-${b.id}`,
      type: 'verify_booking',
      title: `Review booking ${b.id}`,
      description: `${b.service?.name || 'Service'} — status ${b.status}`,
      severity: b.status === 'pending' ? 'high' : 'medium',
    });
  }
  for (const a of agents || []) {
    if ((a.rating ?? 5) < 4.0) {
      actions.push({
        id: `coach-${a.id}`,
        type: 'review_agent',
        title: `Coach low performer: ${a.name}`,
        description: `Rating ${a.rating}, ${a.total_jobs_completed ?? 0} jobs completed`,
        severity: 'medium',
      });
    }
  }
  return actions;
}

export interface DashboardOverviewProps {
  notifications?: number;
  userRole?: string;
}

export default function DashboardOverview({ notifications, userRole = 'super_admin' }: DashboardOverviewProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recent, setRecent] = useState<BookingRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [pendingDocs, setPendingDocs] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // B2B / Industrial Admin scope: hide consumer bookings, agent management,
  // and any "field rep" oriented panel. Their dashboard becomes purely an
  // industrial-pipeline overview.
  const b2bOnly = can(userRole, CAP.SCOPE_B2B_ONLY);
  const canSeeAgents = can(userRole, CAP.AGENT_VIEW);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const [summaryData, recentData, agentsData, pendingDocsData] = await Promise.all([
          dashboardAPI.getSummary(),
          dashboardAPI.getRecentBookings(5),
          // Skip the agent-performance call entirely when the role can't
          // view agents — saves a needless round-trip and removes any risk
          // of the data leaking via dev-tools / network tab.
          canSeeAgents ? agentsAPI.getPerformance(20) : Promise.resolve([]),
          dashboardAPI.getPendingDocumentation(),
        ]);
        setSummary(summaryData as DashboardSummary | null);
        setRecent(Array.isArray(recentData) ? (recentData as BookingRecord[]) : []);
        setAgents(Array.isArray(agentsData) ? (agentsData as AgentRecord[]) : []);
        setPendingDocs(
          Array.isArray(pendingDocsData) ? (pendingDocsData as BookingRecord[]) : [],
        );
      } catch (e: any) {
        console.error('dashboard load failed:', e);
        setError(e);
      } finally {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  // Apply the B2B scope to the data we display: industrial bookings only.
  const isIndustrial = (b: BookingRecord): boolean =>
    (b.booking_type || b.service?.service_type || 'consumer') === 'industrial';
  const visibleRecent = b2bOnly ? recent.filter(isIndustrial) : recent;
  const visiblePendingDocs = b2bOnly ? pendingDocs.filter(isIndustrial) : pendingDocs;

  if (loading && !summary) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading your latest data…</p>
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="p-6 border border-red-200 bg-red-50 text-red-800 rounded-lg">
        <p className="font-semibold mb-1">Could not reach the backend</p>
        <p className="text-sm mb-2">{error.message}</p>
        <p className="text-xs">
          The server may be temporarily unreachable. Please try refreshing the
          page in a moment, or contact support if the issue persists.
        </p>
      </div>
    );
  }

  const alerts = deriveAlerts({
    agents: canSeeAgents ? agents : [],
    pendingDocs: visiblePendingDocs,
    summary,
  });
  const pendingActions = derivePendingActions({
    pendingDocs: visiblePendingDocs,
    agents: canSeeAgents ? agents : [],
  });
  const lowPerformers = canSeeAgents
    ? (agents || []).filter((a) => (a.rating ?? 5) < 4.0)
    : [];

  const handleAction = (action: PendingAction): void => {
    window.dispatchEvent(
      new CustomEvent('admin:navigate', {
        detail:
          action.type === 'review_agent'
            ? { section: 'agents', agentId: action.id.replace('coach-', '') }
            : { section: 'orders', orderId: action.id.replace('verify-', '') },
      }),
    );
  };

  return (
    <div className="space-y-6">
      {/* Hero banner — brand-tinted with the marketing headline. */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 sm:p-8 text-white fade-in-up"
        style={{
          background:
            'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-banner) 60%, #0a62c8 100%)',
        }}
      >
        {/* Decorative logo-accent orbs */}
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-30 float-y"
          style={{ background: 'var(--brand-sun)' }}
        />
        <div
          aria-hidden
          className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full opacity-20"
          style={{ background: 'var(--brand-flag)' }}
        />
        <div className="relative flex flex-wrap justify-between items-start gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-widest font-bold text-white/70 mb-1">
              FliponeX Admin Console
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
              India&apos;s 1 Doorstep Digital Service — At Your Home & Office.
            </h2>
            <p className="text-sm sm:text-base text-white/85 mt-2">
              Skip the queues, stay online. Manage 100+ Government & Digital services from one control room.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="relative w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-2xl glow-yellow"
              title="Incoming bookings / pending actions"
            >
              🔔
              {(notifications ?? 0) > 0 && (
                <span
                  className="absolute -top-1 -right-1 text-[10px] text-white rounded-full px-1.5 py-0.5 font-bold pulse-brand"
                  style={{ background: 'var(--brand-flag)' }}
                >
                  {(notifications ?? 0) > 99 ? '99+' : notifications}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs — each tile is a shortcut into the relevant section. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 stagger">
        <MetricCard
          title="Daily Bookings"
          value={summary?.bookings?.today ?? 0}
          trend={summary?.bookings?.deltaPct ?? 0}
          hint={`Yesterday: ${summary?.bookings?.yesterday ?? 0}`}
          icon="📅"
          accent="b"
          onClick={() => navigateToSection('orders')}
        />
        {canSeeAgents ? (
          <MetricCard
            title="Active Field Representatives"
            value={`${summary?.agents?.active ?? 0} / ${summary?.agents?.total ?? 0}`}
            hint="Online right now"
            icon="👤"
            accent="t"
            onClick={() => navigateToSection('agents')}
          />
        ) : (
          <MetricCard
            title="Industrial Files"
            value={visibleRecent.length}
            hint="Recent industrial bookings"
            icon="🏭"
            accent="t"
            onClick={() => navigateToSection('b2b')}
          />
        )}
        <MetricCard
          title="Gross Revenue (MTD)"
          value={money(summary?.revenue?.thisMonth ?? 0)}
          trend={summary?.revenue?.deltaPct ?? 0}
          hint={`Last month: ${money(summary?.revenue?.lastMonth ?? 0)}`}
          icon="💰"
          accent="g"
          onClick={() => navigateToSection('accounts')}
        />
        <MetricCard
          title="Pending Actions"
          value={summary?.pendingActions ?? 0}
          hint="Bookings awaiting admin action"
          icon="⏳"
          accent="r"
          onClick={() => {
            // Scroll to the Pending Actions panel lower on the same page.
            if (typeof document !== 'undefined') {
              const el = document.getElementById('pending-actions-panel');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Pending action visibility */}
          <div
            id="pending-actions-panel"
            className="bg-white rounded-lg shadow p-6 border border-gray-200 lift scroll-mt-20"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Pending Actions</h3>
              <span className="text-xs text-gray-500">{pendingActions.length} open</span>
            </div>
            {pendingActions.length === 0 ? (
              <p className="text-sm text-gray-500">No outstanding actions. Great work.</p>
            ) : (
              <div className="space-y-2">
                {pendingActions.slice(0, 6).map((a) => (
                  <PendingActionRow key={a.id} action={a} onAct={handleAction} />
                ))}
              </div>
            )}
          </div>

          {/* Operational alerts */}
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200 lift">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Operational Alerts</h3>
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-500">No operational alerts.</p>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <AlertItem key={alert.id} alert={alert} />
                ))}
              </div>
            )}
          </div>

          {/* Recent orders — table layout on md+ screens, stacked card
              layout on mobile/tablet so long UUIDs and service names
              don't overlap. The table version uses fixed column widths
              + truncate so each column stays in its lane. */}
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200 lift">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {b2bOnly ? 'Recent Industrial Files' : 'Recent Orders'}
            </h3>

            {visibleRecent.length === 0 ? (
              <p className="text-sm text-gray-500">
                {b2bOnly ? 'No recent industrial files.' : 'No recent orders yet.'}
              </p>
            ) : (
              <>
                {/* Mobile / tablet card layout (< md). Each order is a
                    self-contained block — no horizontal scrolling, no
                    truncation collisions. */}
                <ul className="space-y-3 md:hidden">
                  {visibleRecent.map((o) => {
                    const amount = money(
                      Number(o.final_price) || Number(o.price_quoted) || Number(o.amount) || 0,
                    );
                    return (
                      <li
                        key={o.id}
                        className="border border-gray-200 rounded-lg p-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">
                              {o.customer?.name || '—'}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {o.service?.name || '—'}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 px-2 py-0.5 rounded-full text-xs ${
                              statusTone[o.status as StatusKey] || 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {(o.status || '').replace('_', ' ')}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                          <span className="font-mono truncate" title={String(o.id)}>
                            #{String(o.id).slice(0, 8)}
                          </span>
                          <span className="font-semibold text-gray-900">{amount}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Desktop table layout (md+). table-fixed enforces the
                    column widths so long values truncate instead of
                    pushing into the next column. */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-[100px]" />
                      <col className="w-[28%]" />
                      <col className="w-[32%]" />
                      <col className="w-[120px]" />
                      <col className="w-[100px]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b text-xs uppercase tracking-wide text-gray-500">
                        <th className="text-left py-2 font-semibold">Order</th>
                        <th className="text-left py-2 font-semibold">{b2bOnly ? 'Company' : 'Customer'}</th>
                        <th className="text-left py-2 font-semibold">Service</th>
                        <th className="text-left py-2 font-semibold">Status</th>
                        <th className="text-right py-2 font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRecent.map((o) => (
                        <tr key={o.id} className="border-b last:border-b-0">
                          <td
                            className="py-3 pr-2 font-mono text-xs text-gray-700 truncate"
                            title={String(o.id)}
                          >
                            #{String(o.id).slice(0, 8)}
                          </td>
                          <td
                            className="py-3 pr-2 truncate"
                            title={o.customer?.name || ''}
                          >
                            {o.customer?.name || '—'}
                          </td>
                          <td
                            className="py-3 pr-2 truncate text-gray-600"
                            title={o.service?.name || ''}
                          >
                            {o.service?.name || '—'}
                          </td>
                          <td className="py-3 pr-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${
                                statusTone[o.status as StatusKey] || 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {(o.status || '').replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 text-right font-semibold whitespace-nowrap">
                            {money(
                              Number(o.final_price) ||
                                Number(o.price_quoted) ||
                                Number(o.amount) ||
                                0,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Low-performance agents panel — hidden for roles without
              AGENT_VIEW (e.g. B2B / Industrial Admin), per the spec:
              no access to general field agent management. */}
          {canSeeAgents && (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 lift">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Low-Performance Representatives</h3>
              {lowPerformers.length === 0 ? (
                <p className="text-sm text-gray-500">All representatives above 4.0 rating.</p>
              ) : (
                <div className="space-y-3">
                  {lowPerformers.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-3 border border-yellow-200 bg-yellow-50 rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{a.name}</p>
                        <p className="text-xs text-gray-600">
                          Rating {a.rating} · {a.total_jobs_completed ?? 0} jobs
                        </p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          a.online_status ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {a.online_status ? 'online' : 'offline'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200 lift">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('admin:navigate', { detail: { section: 'orders' } }),
                  )
                }
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-left"
              >
                📋 Review pending orders ({summary?.pendingActions ?? 0})
              </button>
              {canSeeAgents ? (
                <button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('admin:navigate', { detail: { section: 'agents' } }),
                    )
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-left"
                >
                  👥 Manage agents
                </button>
              ) : (
                b2bOnly && (
                  <button
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('admin:navigate', { detail: { section: 'b2b' } }),
                      )
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-left"
                  >
                    🏭 Open B2B Pipeline
                  </button>
                )
              )}
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('admin:navigate', { detail: { section: 'reports' } }),
                  )
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-left"
              >
                📊 Open reports
              </button>
            </div>
          </div>

          {/* Performance summary — drop the agent share for roles without
              agent visibility (industrial admin, finance, etc.). */}
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200 lift">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Summary</h3>
            <div className="space-y-4">
              {canSeeAgents && (
                <Bar
                  label="Active agent share"
                  value={percent(summary?.agents?.active, summary?.agents?.total)}
                  tone="bg-green-600"
                />
              )}
              <Bar
                label="Bookings trend"
                value={clamp(50 + (summary?.bookings?.deltaPct ?? 0), 0, 100)}
                tone="bg-blue-600"
              />
              <Bar
                label="Revenue trend"
                value={clamp(50 + (summary?.revenue?.deltaPct ?? 0), 0, 100)}
                tone="bg-yellow-600"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const v = Math.round(value);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span>{v}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`${tone} h-2 rounded-full`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function percent(n?: number, d?: number): number {
  if (!d) return 0;
  return Math.min(100, Math.max(0, ((n ?? 0) / d) * 100));
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
