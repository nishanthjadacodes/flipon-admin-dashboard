'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { reportsAPI } from '@/utils/api';
import { CAP, can, type Capability } from '@/utils/rbac';
import { saveTextFile } from '@/utils/csv';

// Maps 1:1 to the backend endpoints in flipon-backend/src/controllers/reportsController.js.
type TabId = 'operational' | 'agents' | 'revenue' | 'service_demand' | 'pending_docs';

interface TabSpec {
  id: TabId;
  label: string;
  hint: string;
  cap: Capability;
}

const TABS: TabSpec[] = [
  { id: 'operational', label: 'Daily Operational', hint: 'Bookings, completions, cancellations', cap: CAP.REPORT_OPERATIONAL },
  { id: 'agents', label: 'Representative Performance', hint: 'Rating, jobs completed, online representatives', cap: CAP.REPORT_AGENTS },
  { id: 'revenue', label: 'Revenue B2C vs B2B', hint: 'Consumer vs industrial split', cap: CAP.REPORT_REVENUE },
  { id: 'service_demand', label: 'Service Demand', hint: 'High-demand services & zones', cap: CAP.REPORT_SERVICE_DEMAND },
  { id: 'pending_docs', label: 'Pending Documentation', hint: '', cap: CAP.REPORT_PENDING_DOCS },
];

interface WindowOption {
  value: number;
  label: string;
}

const WINDOWS: WindowOption[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const money = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '—';
};
const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};
const fmtRating = (r: unknown): string => {
  const n = Number(r);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) : '—';
};

interface CardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: string;
}

function Card({ label, value, hint, tone = 'bg-gray-50' }: CardProps) {
  return (
    <div className={`${tone} p-4 rounded-lg border border-gray-200`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

interface DownloadCsvButtonProps<T extends Record<string, unknown>> {
  rows: T[];
  filename: string;
}

function DownloadCsvButton<T extends Record<string, unknown>>({
  rows,
  filename,
}: DownloadCsvButtonProps<T>) {
  if (!rows || rows.length === 0) return null;
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    keys.join(','),
    ...rows.map((r) => keys.map((k) => escape((r as Record<string, unknown>)[k])).join(',')),
  ].join('\n');
  // saveTextFile handles both the browser (Blob download) and the
  // customer-app WebView (postMessage → native share sheet) — the
  // raw Blob trick used here before silently failed inside the
  // WebView, which is why Export CSV looked dead in the mobile app.
  const download = (): void => saveTextFile(filename, csv, 'text/csv;charset=utf-8');
  return (
    <button
      onClick={download}
      className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700"
    >
      Export CSV
    </button>
  );
}

/* ─── Operational report ────────────────────────────────────────────────── */

interface OperationalRow {
  date: string;
  total?: number;
  completed?: number;
  cancelled?: number;
  revenue?: number;
}

function OperationalReport({ days }: { days: number }) {
  const [data, setData] = useState<OperationalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reportsAPI
      .getOperational({ days })
      .then((d) => !cancelled && setData(Array.isArray(d) ? (d as OperationalRow[]) : []))
      .catch((e: any) => !cancelled && setError(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const totals = useMemo(() => {
    if (!data) return null;
    return data.reduce(
      (acc, r) => ({
        total: acc.total + (r.total || 0),
        completed: acc.completed + (r.completed || 0),
        cancelled: acc.cancelled + (r.cancelled || 0),
        revenue: acc.revenue + Number(r.revenue || 0),
      }),
      { total: 0, completed: 0, cancelled: 0, revenue: 0 },
    );
  }, [data]);

  if (loading) return <p className="text-gray-500 text-sm">Loading operational report…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;
  if (!data || data.length === 0) return <p className="text-gray-500 text-sm">No data in window.</p>;

  const completionPct = totals!.total ? Math.round((totals!.completed / totals!.total) * 100) : 0;
  const maxCount = Math.max(...data.map((r) => r.total || 0), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Total bookings" value={totals!.total} hint={`Window: last ${days} days`} />
        <Card
          label="Completed"
          value={totals!.completed}
          hint={`${completionPct}% completion`}
          tone="bg-green-50"
        />
        <Card label="Cancelled" value={totals!.cancelled} tone="bg-red-50" />
        <Card label="Revenue" value={money(totals!.revenue)} tone="bg-yellow-50" />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-3">Daily trend</h4>
        <div className="space-y-2">
          {data.map((r) => (
            <div key={r.date} className="flex items-center gap-3 text-xs">
              <span className="w-20 text-gray-600">{r.date}</span>
              <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden flex">
                <div
                  className="bg-green-500"
                  style={{ width: `${((r.completed || 0) / maxCount) * 100}%` }}
                  title={`${r.completed} completed`}
                />
                <div
                  className="bg-red-400"
                  style={{ width: `${((r.cancelled || 0) / maxCount) * 100}%` }}
                  title={`${r.cancelled} cancelled`}
                />
                <div
                  className="bg-blue-300"
                  style={{
                    width: `${(((r.total || 0) - (r.completed || 0) - (r.cancelled || 0)) / maxCount) * 100}%`,
                  }}
                  title="other"
                />
              </div>
              <span className="w-12 text-right text-gray-700 tabular-nums">{r.total}</span>
              <span className="w-20 text-right text-gray-500 tabular-nums">{money(r.revenue)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <DownloadCsvButton
          rows={data as unknown as Record<string, unknown>[]}
          filename={`operational-${days}d.csv`}
        />
      </div>
    </div>
  );
}

/* ─── Agent performance report ──────────────────────────────────────────── */

interface AgentPerformanceRow {
  id: string;
  name?: string;
  mobile?: string;
  assigned_zone?: string;
  online_status?: boolean;
  rating?: number;
  total_jobs_completed?: number;
}

function AgentPerformanceReport({ limit = 50 }: { limit?: number }) {
  const [data, setData] = useState<AgentPerformanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reportsAPI
      .getAgentPerformance({ limit })
      .then((d) => !cancelled && setData(Array.isArray(d) ? (d as AgentPerformanceRow[]) : []))
      .catch((e: any) => !cancelled && setError(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [limit]);

  if (loading) return <p className="text-gray-500 text-sm">Loading representative performance…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;
  if (!data || data.length === 0) return <p className="text-gray-500 text-sm">No representatives yet.</p>;

  const online = data.filter((a) => a.online_status).length;
  const avgRating = (() => {
    const rated = data.filter((a) => Number(a.rating) > 0);
    if (rated.length === 0) return '—';
    return (rated.reduce((s, a) => s + Number(a.rating), 0) / rated.length).toFixed(2);
  })();
  const totalJobs = data.reduce((s, a) => s + (a.total_jobs_completed || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Active agents" value={data.length} />
        <Card label="Online now" value={online} tone="bg-green-50" />
        <Card label="Average rating" value={avgRating} tone="bg-yellow-50" />
        <Card label="Total jobs completed" value={totalJobs} tone="bg-blue-50" />
      </div>

      {/* overflow-x-auto (not overflow-hidden) so the table can scroll
          sideways inside the narrow mobile WebView instead of clipping
          the right-most columns against the rounded border. */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left py-2 px-3">Name</th>
              <th className="text-left py-2 px-3">Mobile</th>
              <th className="text-left py-2 px-3">Zone</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-right py-2 px-3">Rating</th>
              <th className="text-right py-2 pl-3 pr-4">Jobs</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2 px-3 font-medium">{a.name || '—'}</td>
                <td className="py-2 px-3 text-gray-600">{a.mobile || '—'}</td>
                <td className="py-2 px-3 text-gray-600">{a.assigned_zone || '—'}</td>
                <td className="py-2 px-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      a.online_status ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {a.online_status ? 'online' : 'offline'}
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums">⭐ {fmtRating(a.rating)}</td>
                <td className="py-2 pl-3 pr-4 text-right tabular-nums">{a.total_jobs_completed ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <DownloadCsvButton
          rows={data.map((a) => ({
            id: a.id,
            name: a.name,
            mobile: a.mobile,
            zone: a.assigned_zone,
            online: a.online_status,
            rating: a.rating,
            jobs_completed: a.total_jobs_completed,
          })) as unknown as Record<string, unknown>[]}
          filename="agent-performance.csv"
        />
      </div>
    </div>
  );
}

/* ─── Revenue B2C vs B2B ────────────────────────────────────────────────── */

interface RevenueSlice {
  count?: number;
  revenue?: number | string;
}
interface RevenueData {
  consumer?: RevenueSlice;
  industrial?: RevenueSlice;
}

function RevenueReport({ days, b2bOnly }: { days: number; b2bOnly: boolean }) {
  const [data, setData] = useState<RevenueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reportsAPI
      .getRevenueSummary({ days })
      .then((d) => !cancelled && setData(d && typeof d === 'object' ? (d as RevenueData) : null))
      .catch((e: any) => !cancelled && setError(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading) return <p className="text-gray-500 text-sm">Loading revenue split…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;
  if (!data) return <p className="text-gray-500 text-sm">No data.</p>;

  const b2c: RevenueSlice = data.consumer || { count: 0, revenue: 0 };
  const b2b: RevenueSlice = data.industrial || { count: 0, revenue: 0 };

  if (b2bOnly) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card
            label="B2B revenue"
            value={money(b2b.revenue)}
            hint={`Last ${days} days`}
            tone="bg-indigo-50"
          />
          <Card label="B2B bookings" value={b2b.count ?? 0} tone="bg-indigo-50" />
          <Card
            label="Average ticket"
            value={
              b2b.count ? money(Math.round(Number(b2b.revenue) / (b2b.count as number))) : '—'
            }
          />
        </div>
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          Scoped to industrial / B2B per your role. Consumer revenue is restricted.
        </div>
      </div>
    );
  }

  const total = Number(b2c.revenue) + Number(b2b.revenue);
  const pctB2c = total ? Math.round((Number(b2c.revenue) / total) * 100) : 0;
  const pctB2b = 100 - pctB2c;
  const bookingsTotal = (b2c.count || 0) + (b2b.count || 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Total revenue" value={money(total)} hint={`Last ${days} days`} />
        <Card
          label="B2C revenue"
          value={money(b2c.revenue)}
          hint={`${pctB2c}% · ${b2c.count} bookings`}
          tone="bg-blue-50"
        />
        <Card
          label="B2B revenue"
          value={money(b2b.revenue)}
          hint={`${pctB2b}% · ${b2b.count} bookings`}
          tone="bg-indigo-50"
        />
        <Card
          label="Average ticket"
          value={bookingsTotal ? money(Math.round(total / bookingsTotal)) : '—'}
        />
      </div>

      {/* Empty-state notice — fired when either B2C or B2B genuinely
          has zero paid bookings in the selected window, so the ₹0 card
          reads as expected rather than as a missing-data bug. */}
      {bookingsTotal === 0 ? (
        <div className="p-3 rounded bg-gray-50 border border-gray-200 text-gray-700 text-xs">
          No paid bookings in the last {days} days. Numbers will populate once
          customers complete payment on a booking.
        </div>
      ) : b2b.count === 0 ? (
        <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          No paid B2B bookings in this window — all {b2c.count} bookings were
          B2C. B2B numbers will populate once an industrial enquiry converts
          to a paid booking.
        </div>
      ) : null}

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-3">B2C vs B2B split</h4>
        <div className="h-5 w-full bg-gray-100 rounded overflow-hidden flex">
          <div
            className="bg-blue-500 text-xs text-white text-center"
            style={{ width: `${pctB2c}%` }}
          >
            {pctB2c > 8 && `${pctB2c}% B2C`}
          </div>
          <div
            className="bg-indigo-500 text-xs text-white text-center"
            style={{ width: `${pctB2b}%` }}
          >
            {pctB2b > 8 && `${pctB2b}% B2B`}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Service demand ────────────────────────────────────────────────────── */

interface ServiceDemandRow {
  service_id?: string;
  id?: string;
  count?: number | string;
  revenue?: number;
  service?: { name?: string; service_type?: 'consumer' | 'industrial' | string };
}

interface ZoneRow {
  zone?: string;
  count?: number | string;
  revenue?: number;
}

function ServiceDemandReport({ days, b2bOnly }: { days: number; b2bOnly: boolean }) {
  const [data, setData] = useState<ServiceDemandRow[] | null>(null);
  const [zones, setZones] = useState<ZoneRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      reportsAPI.getServiceDemand({ days }),
      reportsAPI.getZones({ days }),
    ])
      .then(([svc, zn]) => {
        if (cancelled) return;
        if (svc.status === 'fulfilled') {
          setData(Array.isArray(svc.value) ? (svc.value as ServiceDemandRow[]) : []);
        } else {
          setError(svc.reason?.message || String(svc.reason));
        }
        if (zn.status === 'fulfilled') {
          setZones(Array.isArray(zn.value) ? (zn.value as ZoneRow[]) : []);
        }
        // zone endpoint failure is non-fatal — just skip the heatmap block.
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading) return <p className="text-gray-500 text-sm">Loading service demand…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;
  if (!data || data.length === 0)
    return <p className="text-gray-500 text-sm">No bookings in window.</p>;

  const rows = b2bOnly
    ? data.filter((r) => (r.service?.service_type || 'consumer') === 'industrial')
    : data;
  if (b2bOnly && rows.length === 0) {
    return <p className="text-gray-500 text-sm">No industrial service demand in window.</p>;
  }

  const maxCount = Math.max(...rows.map((r) => Number(r.count) || 0), 1);

  const zoneRows: ZoneRow[] = Array.isArray(zones) ? zones : [];
  const maxZoneCount =
    zoneRows.length > 0 ? Math.max(...zoneRows.map((z) => Number(z.count) || 0), 1) : 1;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 mb-3">
          {b2bOnly ? 'Top industrial services by demand' : 'Top services by demand'}
        </h4>
        <div className="space-y-2">
          {rows.slice(0, 20).map((row) => (
            <div key={row.service_id || row.id} className="flex items-center gap-3 text-sm">
              <span className="w-48 truncate">{row.service?.name || '—'}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded">
                <div
                  className="h-4 bg-blue-500 rounded"
                  style={{ width: `${(Number(row.count) / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-12 text-right tabular-nums">{row.count}</span>
              <span className="w-24 text-right text-gray-500 tabular-nums">
                {money(row.revenue)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {zoneRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-1">Zone heatmap</h4>
          <p className="text-xs text-gray-500 mb-3">
            High-demand zones — useful for rebalancing agent deployment.
          </p>
          <div className="space-y-2">
            {zoneRows.slice(0, 15).map((z, i) => {
              const intensity = Math.min(100, Math.round((Number(z.count) / maxZoneCount) * 100));
              return (
                <div key={`${z.zone || 'unz'}-${i}`} className="flex items-center gap-3 text-sm">
                  <span className="w-48 truncate">{z.zone || 'Unassigned'}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-4 rounded"
                      style={{
                        width: `${intensity}%`,
                        background:
                          intensity > 66 ? '#ef4444' : intensity > 33 ? '#f59e0b' : '#10b981',
                      }}
                    />
                  </div>
                  <span className="w-12 text-right tabular-nums">{z.count}</span>
                  <span className="w-24 text-right text-gray-500 tabular-nums">
                    {money(z.revenue)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Pending documentation ─────────────────────────────────────────────── */

interface PendingDocRow {
  id: string;
  status?: string;
  booking_type?: 'consumer' | 'industrial' | string;
  service?: { name?: string; service_type?: 'consumer' | 'industrial' | string };
  agent?: { name?: string };
  created_at?: string;
}

function PendingDocsReport({ b2bOnly }: { b2bOnly: boolean }) {
  const [data, setData] = useState<PendingDocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reportsAPI
      .getPendingDocumentation()
      .then((d) => !cancelled && setData(Array.isArray(d) ? (d as PendingDocRow[]) : []))
      .catch((e: any) => !cancelled && setError(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-gray-500 text-sm">Loading pending documentation…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;

  // B2B / Industrial Admin scope: hide consumer rows entirely. Match either
  // booking.booking_type or booking.service.service_type so we work whether
  // the backend tags the booking or only the underlying service.
  const rows = b2bOnly
    ? (data || []).filter(
        (r) =>
          (r.booking_type || r.service?.service_type || 'consumer') === 'industrial',
      )
    : (data || []);

  if (rows.length === 0)
    return (
      <p className="text-gray-500 text-sm">
        {b2bOnly ? 'No industrial bookings pending documentation.' : 'Nothing pending 🎉'}
      </p>
    );

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left py-2 px-3">Ref</th>
            <th className="text-left py-2 px-3">Service</th>
            <th className="text-left py-2 px-3">Representative</th>
            <th className="text-left py-2 px-3">Status</th>
            <th className="text-left py-2 px-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-b">
              <td className="py-2 px-3 font-mono text-xs">{String(b.id).slice(0, 8)}</td>
              <td className="py-2 px-3">{b.service?.name || '—'}</td>
              <td className="py-2 px-3">{b.agent?.name || 'Unassigned'}</td>
              <td className="py-2 px-3 capitalize">{(b.status || '').replace('_', ' ')}</td>
              <td className="py-2 px-3 text-gray-600">{fmtDate(b.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Container ─────────────────────────────────────────────────────────── */

export interface ReportsProps {
  userRole?: string;
}

export default function Reports({ userRole = 'super_admin' }: ReportsProps) {
  const allowedTabs = useMemo(() => TABS.filter((t) => can(userRole, t.cap)), [userRole]);
  const [tab, setTab] = useState<TabId>(allowedTabs[0]?.id || 'operational');
  const [days, setDays] = useState<number>(7);

  // If the current tab disappears (role change), fall back to the first allowed.
  useEffect(() => {
    if (!allowedTabs.some((t) => t.id === tab)) {
      setTab(allowedTabs[0]?.id || 'operational');
    }
  }, [allowedTabs, tab]);

  const activeTab = allowedTabs.find((t) => t.id === tab);
  const b2bOnly = can(userRole, CAP.SCOPE_B2B_ONLY);

  const body: Record<TabId, ReactNode> = {
    operational: <OperationalReport days={days} />,
    agents: <AgentPerformanceReport limit={50} />,
    revenue: <RevenueReport days={days === 7 ? 30 : days} b2bOnly={b2bOnly} />,
    service_demand: <ServiceDemandReport days={days === 7 ? 30 : days} b2bOnly={b2bOnly} />,
    pending_docs: <PendingDocsReport b2bOnly={b2bOnly} />,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Reports & Analytics</h2>
          <p className="text-xs text-gray-500">
            Operational, revenue, and agent-performance insights.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-6 min-w-max">
          {allowedTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-2 border-b-2 font-medium text-sm transition-colors ${
                tab === t.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <p className="text-xs text-gray-500">{activeTab?.hint}</p>

      <div>
        {allowedTabs.length === 0 ? (
          <p className="text-sm text-gray-500">No reports are available for your role.</p>
        ) : (
          body[tab]
        )}
      </div>
    </div>
  );
}
