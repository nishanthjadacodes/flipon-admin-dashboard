'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { adminAPI, dashboardAPI, ordersAPI } from '@/utils/api';

// RBAC roles copied from the client's PDF spec.

type AdminRole =
  | 'super_admin'
  | 'operations_manager'
  | 'b2b_admin'
  | 'finance_admin'
  | 'customer_support';

interface RoleSpec {
  label: string;
  tone: string;
  target: string;
  grants: string[];
  restrictions: string[];
}

const ROLE_SPECS: Record<AdminRole, RoleSpec> = {
  super_admin: {
    label: 'Super Admin',
    tone: 'bg-purple-100 text-purple-800 border-purple-200',
    target: 'Owner / Founder',
    grants: [
      'User management — create/edit/deactivate any Admin, Agent or Customer',
      'Financial configuration — payment gateways, taxes, royalty (2%)',
      'Service catalogue — add/remove B2C/B2B services and global pricing',
      'Global exports — download all financial, user and agent data',
      'Audit logs — monitor activity history of every other admin',
    ],
    restrictions: [],
  },
  operations_manager: {
    label: 'Operations Manager',
    tone: 'bg-blue-100 text-blue-800 border-blue-200',
    target: 'Office Manager / Operations Head',
    grants: [
      'Booking management — assign, reschedule or cancel service bookings',
      'Agent monitoring — live location + duty status (online/offline/busy)',
      'Document verification — approve / reject customer uploads',
      'Dispute resolution — handle complaints and agent escalations',
    ],
    restrictions: [
      'Cannot change service prices, royalty percentages or financial settings',
    ],
  },
  b2b_admin: {
    label: 'B2B / Industrial Admin',
    tone: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    target: 'Industrial Liaisoning Expert',
    grants: [
      'B2B pipeline — manage industrial file stages (Application → Inspection → NOC Issued)',
      'Document vault — secure corporate docs, licenses, heavy files',
      'Corporate reports — B2B segment revenue and growth only',
    ],
    restrictions: ['No access to B2C customer data or general field-agent management'],
  },
  finance_admin: {
    label: 'Finance & Accounts Admin',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    target: 'Accountant / CA',
    grants: [
      'Revenue reports — daily, weekly, monthly summaries',
      'Royalty approval — verify and approve 2% monthly royalty + commissions',
      'Wallet management — agent withdrawals and reconciliations',
    ],
    restrictions: ['Cannot modify bookings, service details, or assign agents'],
  },
  customer_support: {
    label: 'Customer Support Admin',
    tone: 'bg-orange-100 text-orange-800 border-orange-200',
    target: 'Customer Care Team',
    grants: [
      'View booking history and basic contact info',
      'Ticketing system — create/update Help Tickets',
      'In-app communication — chat/call customers and agents',
    ],
    restrictions: ['No delete permissions, no financial data, no admin settings'],
  },
};

const ROLE_ORDER: AdminRole[] = [
  'super_admin',
  'operations_manager',
  'b2b_admin',
  'finance_admin',
  'customer_support',
];

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');

interface AdminUser {
  id: string;
  name?: string;
  email: string;
  mobile?: string;
  role: AdminRole | string;
  is_active?: boolean;
  created_at?: string;
}

interface AdminUserPayload {
  name: string;
  email: string;
  mobile: string;
  role: AdminRole;
  is_active: boolean;
  password?: string;
}

interface AdminUserFormState {
  name: string;
  email: string;
  mobile: string;
  role: AdminRole;
  password: string;
  is_active: boolean;
}

interface AdminUserModalProps {
  initial?: AdminUser;
  onClose: () => void;
  onSave: (payload: AdminUserPayload) => Promise<void>;
  busy: boolean;
  title: string;
}

function AdminUserModal({ initial, onClose, onSave, busy, title }: AdminUserModalProps) {
  const [form, setForm] = useState<AdminUserFormState>({
    name: initial?.name || '',
    email: initial?.email || '',
    mobile: initial?.mobile || '',
    role: (initial?.role as AdminRole) || 'operations_manager',
    password: '',
    is_active: initial?.is_active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const update = <K extends keyof AdminUserFormState>(k: K, v: AdminUserFormState[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));
  const isEdit = !!initial?.id;

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim() || !form.email.trim() || !form.mobile.trim()) {
      setErr('Name, email, and mobile are required.');
      return;
    }
    if (!isEdit && (!form.password || form.password.length < 8)) {
      setErr('Password is required for new admins (min 8 characters).');
      return;
    }
    try {
      const payload: AdminUserPayload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        mobile: form.mobile.trim(),
        role: form.role,
        is_active: form.is_active,
      };
      if (form.password) payload.password = form.password;
      await onSave(payload);
    } catch (e2: any) {
      setErr(e2.message || String(e2));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg p-6 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {err && (
          <div className="p-2 text-sm rounded bg-red-50 border border-red-200 text-red-800">
            {err}
          </div>
        )}

        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Full name</span>
          <input
            required
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Mobile</span>
            <input
              required
              type="tel"
              value={form.mobile}
              onChange={(e) => update('mobile', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Role</span>
          <select
            value={form.role}
            onChange={(e) => update('role', e.target.value as AdminRole)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {ROLE_SPECS[r].label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">{ROLE_SPECS[form.role]?.target}</p>
        </label>
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">
            {isEdit ? 'New password (leave blank to keep existing)' : 'Password'}
          </span>
          <input
            type="password"
            minLength={8}
            autoComplete="new-password"
            required={!isEdit}
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-sm flex items-center space-x-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => update('is_active', e.target.checked)}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <span className="text-gray-700">Active</span>
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create admin'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-3 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─── Financial Configuration panel ────────────────────────────────────── */

interface ConfigRow {
  key: string;
  value?: string | number | null;
  label?: string;
  type?: 'number' | 'enum' | 'text' | string;
  options?: string[];
  is_secret?: boolean;
  has_value?: boolean;
  group?: string;
}

function FinancialConfigPanel() {
  const [schema, setSchema] = useState<ConfigRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string | number>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminAPI.getConfig();
      const rows: ConfigRow[] = Array.isArray(data) ? (data as ConfigRow[]) : [];
      setSchema(rows);
      const next: Record<string, string | number> = {};
      rows.forEach((r) => {
        next[r.key] = (r.value as string | number) ?? '';
      });
      setDraft(next);
      setDirtyKeys(new Set());
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onChange = (key: string, v: string): void => {
    setDraft((prev) => ({ ...prev, [key]: v }));
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (dirtyKeys.size === 0) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const patch: Record<string, unknown> = {};
      dirtyKeys.forEach((k) => {
        patch[k] = draft[k];
      });
      const data = await adminAPI.updateConfig(patch);
      const rows: ConfigRow[] = Array.isArray(data) ? (data as ConfigRow[]) : [];
      setSchema(rows);
      const next: Record<string, string | number> = {};
      rows.forEach((r) => {
        next[r.key] = (r.value as string | number) ?? '';
      });
      setDraft(next);
      setDirtyKeys(new Set());
      setSavedMsg(
        `Saved ${Object.keys(patch).length} setting${Object.keys(patch).length === 1 ? '' : 's'}`,
      );
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading && schema.length === 0)
    return <p className="text-gray-500 text-sm">Loading financial configuration…</p>;
  if (error && schema.length === 0)
    return <p className="text-red-700 text-sm">Failed: {error}</p>;

  const grouped = [
    {
      title: 'Payment gateway',
      keys: ['payment_gateway_provider', 'payment_gateway_mode', 'razorpay_key_id', 'razorpay_key_secret'],
    },
    { title: 'Taxes & royalty', keys: ['tax_percentage', 'royalty_percentage'] },
    {
      title: 'Commissions & surcharges',
      keys: ['agent_commission_percentage', 'urgent_surcharge_percentage'],
    },
  ];
  const byKey = new Map<string, ConfigRow>(schema.map((r) => [r.key, r]));

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
        These settings apply globally. Gateway keys are stored encrypted in the backend and masked
        here — leave a masked field untouched to keep the existing value.
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
      )}
      {savedMsg && (
        <div className="p-3 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
          {savedMsg}
        </div>
      )}

      {grouped.map((group) => (
        <div key={group.title} className="bg-white border border-gray-200 rounded-lg">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h4 className="font-semibold text-gray-900">{group.title}</h4>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.keys.map((key) => {
              const row = byKey.get(key);
              if (!row) return null;
              const value = draft[key] ?? '';
              const isNumber = row.type === 'number';
              const isEnum = row.type === 'enum';
              const isSecret = !!row.is_secret;
              return (
                <label key={key} className="text-sm block">
                  <span className="block text-gray-700 mb-1">
                    {row.label}
                    {isSecret && row.has_value && (
                      <span className="ml-2 text-[10px] text-gray-500 uppercase tracking-wide">
                        encrypted
                      </span>
                    )}
                  </span>
                  {isEnum ? (
                    <select
                      value={value as string}
                      onChange={(e) => onChange(key, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      {row.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={isSecret ? 'password' : isNumber ? 'number' : 'text'}
                      step={isNumber ? '0.01' : undefined}
                      value={value as string}
                      onChange={(e) => onChange(key, e.target.value)}
                      placeholder={isSecret && row.has_value ? '(unchanged)' : ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                      autoComplete="off"
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || dirtyKeys.size === 0}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving
            ? 'Saving…'
            : dirtyKeys.size > 0
              ? `Save ${dirtyKeys.size} change${dirtyKeys.size === 1 ? '' : 's'}`
              : 'No changes'}
        </button>
      </div>
    </form>
  );
}

/* ─── Brand & Content panel ────────────────────────────────────────────── */

function BrandContentPanel() {
  const [schema, setSchema] = useState<ConfigRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('brand');

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminAPI.getConfig();
      const rows: ConfigRow[] = (Array.isArray(data) ? (data as ConfigRow[]) : []).filter(
        (r) => r.group !== 'finance',
      );
      setSchema(rows);
      const next: Record<string, string> = {};
      rows.forEach((r) => {
        next[r.key] = String(r.value ?? '');
      });
      setDraft(next);
      setDirty(new Set());
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const onChange = (key: string, v: string): void => {
    setDraft((p) => ({ ...p, [key]: v }));
    setDirty((p) => {
      const n = new Set(p);
      n.add(key);
      return n;
    });
  };

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (dirty.size === 0) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const patch: Record<string, unknown> = {};
      dirty.forEach((k) => {
        patch[k] = draft[k];
      });
      const updated = await adminAPI.updateConfig(patch);
      const rows: ConfigRow[] = (Array.isArray(updated) ? (updated as ConfigRow[]) : []).filter(
        (r) => r.group !== 'finance',
      );
      setSchema(rows);
      const next: Record<string, string> = {};
      rows.forEach((r) => {
        next[r.key] = String(r.value ?? '');
      });
      setDraft(next);
      setDirty(new Set());
      setSavedMsg(
        `Saved ${Object.keys(patch).length} change${Object.keys(patch).length === 1 ? '' : 's'}`,
      );
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const groups = useMemo<Map<string, ConfigRow[]>>(() => {
    const byGroup = new Map<string, ConfigRow[]>();
    schema.forEach((r) => {
      const g = r.group || 'misc';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(r);
    });
    return byGroup;
  }, [schema]);

  const groupLabels: Record<string, string> = {
    brand: 'Website & App Copy',
    support: 'Support & Contact',
    legal: 'Legal Policies',
    misc: 'Other',
  };

  if (loading && schema.length === 0)
    return <p className="text-sm text-gray-500">Loading brand content…</p>;
  if (error && schema.length === 0) return <p className="text-sm text-red-700">Failed: {error}</p>;

  const activeRows = groups.get(activeGroup) || [];

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="p-3 rounded border border-[var(--brand-sun)] bg-[var(--brand-sun)]/10 text-xs text-gray-700">
        Edit the headline, value props, banner copy, support contacts, and legal policies rendered
        on the FliponeX customer website & app. Changes apply globally and audit-log every save.
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
      )}
      {savedMsg && (
        <div className="p-3 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
          {savedMsg}
        </div>
      )}

      <div className="border-b border-gray-200 flex gap-6 overflow-x-auto">
        {[...groups.keys()].map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setActiveGroup(g)}
            className={`py-2 border-b-2 text-sm font-medium transition-colors ${
              activeGroup === g
                ? 'border-[var(--brand-primary)] text-brand'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {groupLabels[g] || g}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeRows.map((row) => {
          const value = draft[row.key] ?? '';
          const multi = row.type === 'text';
          return (
            <label
              key={row.key}
              className={`text-sm block ${multi ? 'md:col-span-2' : ''}`}
            >
              <span className="block text-gray-700 mb-1 font-medium">{row.label}</span>
              {multi ? (
                <textarea
                  rows={5}
                  value={value}
                  onChange={(e) => onChange(row.key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 ring-brand text-sm"
                />
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => onChange(row.key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 ring-brand text-sm"
                />
              )}
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || dirty.size === 0}
          className="px-4 py-2 bg-brand rounded-lg disabled:opacity-50"
        >
          {saving
            ? 'Saving…'
            : dirty.size > 0
              ? `Save ${dirty.size} change${dirty.size === 1 ? '' : 's'}`
              : 'No changes'}
        </button>
      </div>
    </form>
  );
}

/* ─── Notifications panel ──────────────────────────────────────────────── */

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  ts?: string;
  severity: 'high' | 'medium' | 'low';
}

interface BookingLite {
  id: string;
  status?: string;
  service?: { name?: string };
  customer?: { name?: string };
  customer_name?: string;
  created_at?: string;
}

function NotificationsPanel() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const [bookings, pendingDocs, summary] = await Promise.all([
          ordersAPI.getAll({ status: 'pending', limit: 5 }),
          dashboardAPI.getPendingDocumentation(),
          dashboardAPI.getSummary(),
        ]);
        if (cancelled) return;
        const feed: NotificationItem[] = [];
        (Array.isArray(bookings) ? (bookings as BookingLite[]) : []).forEach((b) => {
          feed.push({
            id: `book-${b.id}`,
            title: 'New booking awaiting review',
            message: `${b.customer?.name || b.customer_name || 'Customer'} → ${b.service?.name || 'service'}`,
            ts: b.created_at,
            severity: 'high',
          });
        });
        (Array.isArray(pendingDocs) ? (pendingDocs as BookingLite[]) : [])
          .slice(0, 5)
          .forEach((b) => {
            feed.push({
              id: `doc-${b.id}`,
              title: 'Documentation pending',
              message: `${b.service?.name || 'service'} · status ${b.status}`,
              ts: b.created_at,
              severity: 'medium',
            });
          });
        const s = summary as { pendingActions?: number } | null;
        if (s?.pendingActions && s.pendingActions > 10) {
          feed.push({
            id: 'backlog',
            title: 'Ops backlog rising',
            message: `${s.pendingActions} pending actions across the platform`,
            ts: new Date().toISOString(),
            severity: 'high',
          });
        }
        setItems(feed);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const severityTone: Record<NotificationItem['severity'], string> = {
    high: 'bg-red-50 border-red-200 text-red-800',
    medium: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    low: 'bg-gray-50 border-gray-200 text-gray-700',
  };

  if (loading) return <p className="text-gray-500 text-sm">Loading notifications…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;
  if (items.length === 0)
    return <p className="text-gray-500 text-sm">No incoming items — inbox clear.</p>;

  return (
    <div className="space-y-2">
      {items.map((n) => (
        <div
          key={n.id}
          className={`p-3 rounded-lg border ${severityTone[n.severity] || severityTone.low}`}
        >
          <div className="flex justify-between items-start gap-2">
            <p className="text-sm font-medium">{n.title}</p>
            <span className="text-xs text-gray-500 whitespace-nowrap">{fmtDate(n.ts)}</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{n.message}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Audit logs panel ─────────────────────────────────────────────────── */

interface AuditLogRecord {
  id: string;
  created_at?: string;
  actor_name?: string;
  actor_role?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: string | Record<string, unknown>;
}

// ─── Global Exports panel ────────────────────────────────────────────────
// Three buttons → three server-side CSV downloads:
//   • Financial   — every completed/submitted booking with gross,
//                   commission, payment status, dates
//   • Users       — full user roster (customers + agents + admins)
//   • Agents      — field-rep roster with KYC + earnings + rating
// Each download is audit-logged on the backend so a Super Admin can
// later see who exported what.
function GlobalExportsPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  type ExportSpec = { id: string; label: string; desc: string; fn: () => Promise<void> };
  const exports: ExportSpec[] = [
    {
      id: 'financial',
      label: 'Financial data',
      desc: 'All completed bookings · gross · agent commission · payment status · dates',
      fn: () => adminAPI.exportFinancial(),
    },
    {
      id: 'users',
      label: 'All users',
      desc: 'Customers, agents, admins · contact details · status · created date',
      fn: () => adminAPI.exportUsers(),
    },
    {
      id: 'agents',
      label: 'All agents',
      desc: 'Field rep roster · KYC status · rating · jobs · wallet balance',
      fn: () => adminAPI.exportAgents(),
    },
  ];

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded">
          {error}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        {exports.map((x) => (
          <div
            key={x.id}
            className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col"
          >
            <div className="font-semibold text-gray-900">{x.label}</div>
            <div className="text-xs text-gray-500 mt-1 mb-4 flex-1">{x.desc}</div>
            <button
              onClick={() => run(x.id, x.fn)}
              disabled={busy !== null}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === x.id ? 'Preparing CSV…' : 'Download CSV'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">
        Exports are capped at 50,000 rows per file and ordered newest-first. Every download is
        written to the audit log (action: <code>export.financial</code> /{' '}
        <code>export.users</code> / <code>export.agents</code>).
      </p>
    </div>
  );
}

function AuditLogsPanel() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminAPI
      .getAuditLogs({ limit: 50 })
      .then((d) => !cancelled && setLogs(Array.isArray(d) ? (d as AuditLogRecord[]) : []))
      .catch((e: any) => !cancelled && setError(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-gray-500 text-sm">Loading audit log…</p>;
  if (error) return <p className="text-red-700 text-sm">Failed: {error}</p>;
  if (logs.length === 0) return <p className="text-gray-500 text-sm">No audit entries yet.</p>;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left py-2 px-3">When</th>
            <th className="text-left py-2 px-3">Actor</th>
            <th className="text-left py-2 px-3">Action</th>
            <th className="text-left py-2 px-3">Resource</th>
            <th className="text-left py-2 px-3">Meta</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">
                {fmtDate(l.created_at)}
              </td>
              <td className="py-2 px-3 text-gray-700">
                <div>{l.actor_name || '—'}</div>
                {l.actor_role && <div className="text-xs text-gray-500">{l.actor_role}</div>}
              </td>
              <td className="py-2 px-3 font-mono text-xs">{l.action}</td>
              <td className="py-2 px-3">
                <div className="text-gray-700">{l.resource_type || '—'}</div>
                {l.resource_id && (
                  <div className="text-xs text-gray-500 font-mono">{shortId(l.resource_id)}</div>
                )}
              </td>
              <td className="py-2 px-3 text-xs text-gray-600 max-w-xs truncate">
                {l.metadata
                  ? typeof l.metadata === 'string'
                    ? l.metadata
                    : JSON.stringify(l.metadata)
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main container ───────────────────────────────────────────────────── */

type AdminTab = 'users' | 'financial' | 'brand' | 'notifications' | 'exports' | 'audit';

interface AdminTabSpec {
  id: AdminTab;
  label: string;
  onlySuper?: boolean;
}

interface ModalState {
  mode: 'create' | 'edit';
  admin?: AdminUser;
}

export interface AdminControlsProps {
  userRole?: string;
}

export default function AdminControls({ userRole }: AdminControlsProps) {
  const [tab, setTab] = useState<AdminTab>('users');
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);

  const isSuper = userRole === 'super_admin';

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await adminAPI.getAdmins();
        if (!cancelled) setAdmins(Array.isArray(data) ? (data as AdminUser[]) : []);
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const adminsByRole = useMemo<Record<AdminRole, AdminUser[]>>(() => {
    const byRole = {} as Record<AdminRole, AdminUser[]>;
    ROLE_ORDER.forEach((r) => {
      byRole[r] = [];
    });
    admins.forEach((a) => {
      const role = a.role as AdminRole;
      if (byRole[role]) byRole[role].push(a);
    });
    return byRole;
  }, [admins]);

  const handleCreate = async (payload: AdminUserPayload): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const created = await adminAPI.createAdmin(payload as unknown as Record<string, unknown>);
      if (created && typeof created === 'object')
        setAdmins((prev) => [created as AdminUser, ...prev]);
      setModalState(null);
      setActionMsg(`Created admin ${payload.email}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdate = (admin: AdminUser) => async (payload: AdminUserPayload): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const updated = await adminAPI.updateAdmin(admin.id, payload as unknown as Record<string, unknown>);
      const row: AdminUser =
        updated && typeof updated === 'object' ? (updated as AdminUser) : { ...admin, ...payload };
      setAdmins((prev) => prev.map((a) => (a.id === admin.id ? row : a)));
      setModalState(null);
      setActionMsg(`Updated ${row.email || admin.email}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeactivate = async (admin: AdminUser): Promise<void> => {
    if (!confirm(`Deactivate ${admin.name || admin.email}? They'll lose admin access.`)) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await adminAPI.deactivateAdmin(admin.id);
      setAdmins((prev) =>
        prev.map((a) => (a.id === admin.id ? { ...a, is_active: false } : a)),
      );
      setActionMsg(`${admin.email} deactivated`);
    } catch (e: any) {
      setActionMsg(`Deactivate failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const tabs: AdminTabSpec[] = [
    { id: 'users', label: 'Admin Users' },
    { id: 'financial', label: 'Financial Config', onlySuper: true },
    { id: 'brand', label: 'Brand & Content', onlySuper: true },
    { id: 'notifications', label: 'Notifications' },
    { id: 'exports', label: 'Global Exports', onlySuper: true },
    { id: 'audit', label: 'Audit Logs', onlySuper: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Admin Controls</h2>
          <p className="text-xs text-gray-500">
            Role-based access control · {admins.length} admin
            {admins.length === 1 ? '' : 's'}
            {userRole
              ? ` · you are ${ROLE_SPECS[userRole as AdminRole]?.label || userRole}`
              : ''}
          </p>
        </div>
        {isSuper && (
          <button
            onClick={() => setModalState({ mode: 'create' })}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add admin
          </button>
        )}
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-6 min-w-max">
          {tabs
            .filter((t) => !t.onlySuper || isSuper)
            .map((t) => (
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

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-6">
          {loading && admins.length === 0 ? (
            <p className="text-gray-500 text-sm">Loading admins…</p>
          ) : (
            ROLE_ORDER.map((role) => {
              const spec = ROLE_SPECS[role];
              const rows = adminsByRole[role];
              if (!rows || rows.length === 0) return null;
              return (
                <div
                  key={role}
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden"
                >
                  <div className={`px-4 py-3 border-b ${spec.tone}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold">{spec.label}</h4>
                        <p className="text-xs opacity-80">{spec.target}</p>
                      </div>
                      <span className="text-xs font-medium">
                        {rows.length} account{rows.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left py-2 px-3">Name</th>
                        <th className="text-left py-2 px-3">Email</th>
                        <th className="text-left py-2 px-3">Mobile</th>
                        <th className="text-left py-2 px-3">Status</th>
                        <th className="text-left py-2 px-3">Created</th>
                        {isSuper && <th className="text-right py-2 px-3">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={a.id} className="border-b">
                          <td className="py-2 px-3 font-medium">{a.name || '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{a.email}</td>
                          <td className="py-2 px-3 text-gray-600">{a.mobile}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs ${
                                a.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                              }`}
                            >
                              {a.is_active ? 'active' : 'inactive'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-gray-600 text-xs">{fmtDate(a.created_at)}</td>
                          {isSuper && (
                            <td className="py-2 px-3 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  onClick={() => setModalState({ mode: 'edit', admin: a })}
                                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                >
                                  Edit
                                </button>
                                {a.is_active && (
                                  <button
                                    disabled={actionBusy}
                                    onClick={() => handleDeactivate(a)}
                                    className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                                  >
                                    Deactivate
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}

          {!loading && admins.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">
              No admin accounts yet.{' '}
              {isSuper
                ? 'Click "Add admin" above to create one.'
                : 'Ask a Super Admin to create one.'}
            </div>
          )}
        </div>
      )}

      {tab === 'financial' && isSuper && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Payment gateway, tax percentage, monthly royalty (2%) logic, and commission defaults.
            Super Admin only.
          </p>
          <FinancialConfigPanel />
        </div>
      )}

      {tab === 'brand' && isSuper && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Customer-facing FliponeX copy: headline, value propositions, banner text, legal
            policies, support contacts and FAQs. Updates here are reflected across the customer
            website and app.
          </p>
          <BrandContentPanel />
        </div>
      )}

      {tab === 'notifications' && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-3">Admin-side notifications</h4>
          <p className="text-xs text-gray-500 mb-3">
            New bookings, stalled documentation and ops backlog pulled live from the backend.
          </p>
          <NotificationsPanel />
        </div>
      )}

      {tab === 'exports' && isSuper && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Server-side CSV exports of the full database. Every download is recorded in the
            audit log (Super Admin only).
          </p>
          <GlobalExportsPanel />
        </div>
      )}

      {tab === 'audit' && isSuper && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Activity trail of admin actions (create/update/deactivate, ticket moves, bookings
            assignment). Super Admin only.
          </p>
          <AuditLogsPanel />
        </div>
      )}

      {modalState?.mode === 'create' && (
        <AdminUserModal
          title="Add admin user"
          onClose={() => setModalState(null)}
          onSave={handleCreate}
          busy={actionBusy}
        />
      )}
      {modalState?.mode === 'edit' && modalState.admin && (
        <AdminUserModal
          title={`Edit ${modalState.admin.name || modalState.admin.email}`}
          initial={modalState.admin}
          onClose={() => setModalState(null)}
          onSave={handleUpdate(modalState.admin)}
          busy={actionBusy}
        />
      )}
    </div>
  );
}
