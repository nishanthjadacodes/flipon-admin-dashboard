'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { payoutsAPI, royaltyAPI, reportsAPI, agentsAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';
import { downloadCsv } from '@/utils/csv';

// Finance & Accounts Admin home — revenue + royalty + wallet/payouts.

const money = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '—';
};
const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');

type PayoutStatus = 'requested' | 'approved' | 'paid' | 'rejected';
type RoyaltyStatus = 'pending' | 'approved' | 'paid' | 'rejected';

const PAYOUT_TONE: Record<PayoutStatus, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const ROYALTY_TONE: Record<RoyaltyStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
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

/* ─── Revenue summary ──────────────────────────────────────────────────── */

interface OperationalRow {
  date: string;
  revenue?: number | string;
}

interface MonthlyRevenue {
  consumer?: { revenue?: number };
  industrial?: { revenue?: number };
}

function RevenueSummary() {
  const [daily, setDaily] = useState<OperationalRow[] | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRevenue | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const [d30, m30] = await Promise.all([
          reportsAPI.getOperational({ days: 30 }),
          reportsAPI.getRevenueSummary({ days: 30 }),
        ]);
        if (cancelled) return;
        setDaily(Array.isArray(d30) ? (d30 as OperationalRow[]) : []);
        setMonthly(m30 && typeof m30 === 'object' ? (m30 as MonthlyRevenue) : null);
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

  if (loading) return <p className="text-sm text-gray-500">Loading revenue summary…</p>;
  if (error) return <p className="text-sm text-red-700">Failed: {error}</p>;

  const dayCount = daily?.length || 0;
  const last7 = (daily || []).slice(-7);
  const last30Total = (daily || []).reduce((s, r) => s + Number(r.revenue || 0), 0);
  const last7Total = last7.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const todaysRev = Number((daily || [])[dayCount - 1]?.revenue || 0);
  const b2c = monthly?.consumer?.revenue || 0;
  const b2b = monthly?.industrial?.revenue || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Today" value={money(todaysRev)} hint="Running day total" />
        <Card label="Last 7 days" value={money(last7Total)} tone="bg-blue-50" />
        <Card label="Last 30 days" value={money(last30Total)} tone="bg-emerald-50" />
        <Card
          label="B2C vs B2B"
          value={`${money(b2c)} / ${money(b2b)}`}
          hint="Last 30d"
          tone="bg-indigo-50"
        />
      </div>
    </div>
  );
}

/* ─── Payouts tab ──────────────────────────────────────────────────────── */

interface AgentLite {
  id: string;
  name?: string;
  mobile?: string;
}

interface PayoutRow {
  id: string;
  agent_id?: string;
  agent?: { name?: string; mobile?: string };
  amount: number;
  method?: string;
  status: PayoutStatus;
  reference?: string;
  approved_at?: string;
  paid_at?: string;
  created_at?: string;
}

interface PayoutStats {
  requested?: number;
  approved?: number;
  paid?: number;
}

interface CreatePayoutPayload {
  agent_id: string;
  amount: number;
  method: string;
  note: string | null;
}

interface CreatePayoutModalProps {
  agents: AgentLite[];
  onClose: () => void;
  onCreated: (payload: CreatePayoutPayload) => Promise<void>;
  busy: boolean;
}

function CreatePayoutModal({ agents, onClose, onCreated, busy }: CreatePayoutModalProps) {
  const [agentId, setAgentId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [method, setMethod] = useState<string>('bank_transfer');
  const [note, setNote] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErr(null);
    if (!agentId) {
      setErr('Pick an agent');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr('Enter a positive amount');
      return;
    }
    try {
      await onCreated({ agent_id: agentId, amount: amt, method, note: note.trim() || null });
    } catch (e2: any) {
      setErr(e2.message || String(e2));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg p-6 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-semibold text-gray-900">Record payout request</h3>
        {err && (
          <div className="p-2 text-sm rounded bg-red-50 border border-red-200 text-red-800">
            {err}
          </div>
        )}

        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Representative</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">Select a representative…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.mobile || shortId(a.id)} {a.mobile ? `· ${a.mobile}` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Amount (₹)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Method</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="bank_transfer">bank transfer</option>
              <option value="upi">UPI</option>
              <option value="cash">cash</option>
              <option value="cheque">cheque</option>
            </select>
          </label>
        </div>

        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Recording…' : 'Record request'}
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

interface PayoutsTabProps {
  canCreate: boolean;
  canApprove: boolean;
}

function PayoutsTab({ canCreate, canApprove }: PayoutsTabProps) {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [stats, setStats] = useState<PayoutStats | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | PayoutStatus>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState<boolean>(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = filterStatus === 'all' ? {} : { status: filterStatus };
      const [listData, statsData, agentsData] = await Promise.all([
        payoutsAPI.list({ ...params, limit: 200 }),
        payoutsAPI.stats(),
        canCreate ? agentsAPI.getAll({ status: 'active' }) : Promise.resolve([]),
      ]);
      setRows(Array.isArray(listData) ? (listData as PayoutRow[]) : []);
      setStats(statsData && typeof statsData === 'object' ? (statsData as PayoutStats) : null);
      setAgents(Array.isArray(agentsData) ? (agentsData as AgentLite[]) : []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterStatus]);

  const handleCreate = async (payload: CreatePayoutPayload): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await payoutsAPI.create(payload);
      setShowCreate(false);
      setActionMsg('Payout request recorded');
      await load();
    } catch (e) {
      throw e;
    } finally {
      setActionBusy(false);
    }
  };

  const setStatus = async (row: PayoutRow, status: PayoutStatus): Promise<void> => {
    if (!canApprove) return;
    let reference: string | undefined;
    let note: string | undefined;
    if (status === 'paid') reference = prompt('Payment reference (txn ID, UTR…):') || undefined;
    if (status === 'rejected') note = prompt('Reason for rejection:') || undefined;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await payoutsAPI.setStatus(row.id, { status, reference, note });
      setActionMsg(`Payout ${status}`);
      await load();
    } catch (e: any) {
      setActionMsg(`Failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Requested" value={money(stats?.requested)} tone="bg-yellow-50" />
        <Card label="Approved (awaiting payment)" value={money(stats?.approved)} tone="bg-blue-50" />
        <Card label="Paid" value={money(stats?.paid)} tone="bg-green-50" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | PayoutStatus)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="requested">Requested</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            onClick={load}
            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
        <div className="flex gap-2">
          {rows.length > 0 && (
            <button
              onClick={() =>
                downloadCsv<PayoutRow>(`payouts-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
                  { key: 'id', label: 'payout_id' },
                  { key: 'agent', label: 'agent_name', value: (r) => r.agent?.name || '' },
                  { key: 'agent_mobile', label: 'agent_mobile', value: (r) => r.agent?.mobile || '' },
                  { key: 'amount', label: 'amount' },
                  { key: 'method', label: 'method' },
                  { key: 'status', label: 'status' },
                  { key: 'reference', label: 'reference' },
                  { key: 'approved_at', label: 'approved_at' },
                  { key: 'paid_at', label: 'paid_at' },
                  { key: 'created_at', label: 'requested_at' },
                ])
              }
              className="px-3 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700"
            >
              Export CSV
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              + Record payout
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          Failed to load payouts: {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading payouts…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 text-center">
          No payout requests yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left py-2 px-3">Representative</th>
                <th className="text-left py-2 px-3">Amount</th>
                <th className="text-left py-2 px-3">Method</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Requested</th>
                <th className="text-left py-2 px-3">Reference</th>
                {canApprove && <th className="text-right py-2 px-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 px-3">
                    <div className="font-medium text-gray-900">{r.agent?.name || '—'}</div>
                    <div className="text-xs text-gray-500">
                      {r.agent?.mobile || shortId(r.agent_id)}
                    </div>
                  </td>
                  <td className="py-2 px-3 font-semibold">{money(r.amount)}</td>
                  <td className="py-2 px-3 text-gray-600">
                    {(r.method || 'bank_transfer').replace('_', ' ')}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        PAYOUT_TONE[r.status] || PAYOUT_TONE.requested
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-600">{fmtDate(r.created_at)}</td>
                  <td className="py-2 px-3 text-xs text-gray-600">{r.reference || '—'}</td>
                  {canApprove && (
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex flex-wrap gap-1 justify-end">
                        {r.status === 'requested' && (
                          <>
                            <button
                              disabled={actionBusy}
                              onClick={() => setStatus(r, 'approved')}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              disabled={actionBusy}
                              onClick={() => setStatus(r, 'rejected')}
                              className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && (
                          <button
                            disabled={actionBusy}
                            onClick={() => setStatus(r, 'paid')}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            Mark paid
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
      )}

      {showCreate && (
        <CreatePayoutModal
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreate}
          busy={actionBusy}
        />
      )}
    </div>
  );
}

/* ─── Royalty tab ──────────────────────────────────────────────────────── */

const periodFor = (monthsAgo = 0): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 7);
};

interface RoyaltyRow {
  id: string;
  category?: string;
  beneficiary_name?: string;
  amount: number;
  percentage?: number;
  basis_revenue?: number;
  status: RoyaltyStatus;
  approved_at?: string;
}

interface RoyaltySummary {
  period: string;
  percentage: number;
  basis_revenue?: number;
  expected_amount?: number;
  rows?: RoyaltyRow[];
}

interface RoyaltyTabProps {
  canApprove: boolean;
}

function RoyaltyTab({ canApprove }: RoyaltyTabProps) {
  const [period, setPeriod] = useState<string>(periodFor(1));
  const [summary, setSummary] = useState<RoyaltySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await royaltyAPI.summary({ period });
      setSummary(data && typeof data === 'object' ? (data as RoyaltySummary) : null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [period]);

  const generate = async (): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await royaltyAPI.generate({ period });
      setActionMsg(`Generated platform royalty row for ${period}`);
      await load();
    } catch (e: any) {
      setActionMsg(`Generate failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const setStatus = async (row: RoyaltyRow, status: RoyaltyStatus): Promise<void> => {
    if (!canApprove) return;
    let notes: string | undefined;
    if (status === 'rejected') notes = prompt('Reason for rejection:') || undefined;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await royaltyAPI.setStatus(row.id, { status, notes });
      setActionMsg(`Royalty entry ${status}`);
      await load();
    } catch (e: any) {
      setActionMsg(`Failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const addCommission = async (): Promise<void> => {
    const name = prompt('Beneficiary name (team / agent / partner):');
    if (!name || !name.trim()) return;
    const amtStr = prompt('Commission amount (₹):');
    const amt = Number(amtStr);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert('Invalid amount.');
      return;
    }
    const note = prompt('Note (optional):') || undefined;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await royaltyAPI.addCommissions({
        period,
        entries: [{ beneficiary_name: name.trim(), amount: amt, notes: note }],
      });
      setActionMsg(`Commission added for ${name.trim()}`);
      await load();
    } catch (e: any) {
      setActionMsg(`Failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const monthOptions = useMemo<string[]>(() => {
    const opts: string[] = [];
    for (let i = 0; i <= 11; i++) opts.push(periodFor(i));
    return opts;
  }, []);

  if (loading && !summary)
    return <p className="text-sm text-gray-500">Loading royalty summary…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-sm">
            <span className="text-gray-700 mr-2">Period</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {monthOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={load}
            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
        {canApprove && (
          <div className="flex gap-2">
            <button
              disabled={actionBusy}
              onClick={generate}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Generate platform royalty
            </button>
            <button
              disabled={actionBusy}
              onClick={addCommission}
              className="px-3 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
            >
              + Add commission
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          Failed: {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Period" value={summary.period} />
            <Card label="Royalty %" value={`${summary.percentage}%`} hint="From Financial Config" />
            <Card label="Gross basis (paid)" value={money(summary.basis_revenue)} tone="bg-emerald-50" />
            <Card label="Expected amount" value={money(summary.expected_amount)} tone="bg-yellow-50" />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h4 className="font-semibold text-gray-900 text-sm">
                Ledger entries for {summary.period}
              </h4>
              <span className="text-xs text-gray-500">
                {summary.rows?.length || 0} row{summary.rows?.length === 1 ? '' : 's'}
              </span>
            </div>
            {!summary.rows || summary.rows.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">
                No ledger entries yet.{' '}
                {canApprove && 'Click "Generate platform royalty" to create the 2% row.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-2 px-3">Category</th>
                    <th className="text-left py-2 px-3">Beneficiary</th>
                    <th className="text-left py-2 px-3">Amount</th>
                    <th className="text-left py-2 px-3">Basis</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Approved</th>
                    {canApprove && <th className="text-right py-2 px-3">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 px-3 capitalize">{r.category}</td>
                      <td className="py-2 px-3">{r.beneficiary_name}</td>
                      <td className="py-2 px-3 font-semibold">{money(r.amount)}</td>
                      <td className="py-2 px-3 text-xs text-gray-600">
                        {(r.percentage ?? 0) > 0
                          ? `${r.percentage}% of ${money(r.basis_revenue)}`
                          : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            ROYALTY_TONE[r.status] || ROYALTY_TONE.pending
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-600">
                        {r.approved_at ? fmtDate(r.approved_at) : '—'}
                      </td>
                      {canApprove && (
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex flex-wrap gap-1 justify-end">
                            {r.status === 'pending' && (
                              <>
                                <button
                                  disabled={actionBusy}
                                  onClick={() => setStatus(r, 'approved')}
                                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  disabled={actionBusy}
                                  onClick={() => setStatus(r, 'rejected')}
                                  className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {r.status === 'approved' && (
                              <button
                                disabled={actionBusy}
                                onClick={() => setStatus(r, 'paid')}
                                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                Mark paid
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Container ────────────────────────────────────────────────────────── */

type AccountsTab = 'revenue' | 'payouts' | 'royalty';

interface TabSpec {
  id: AccountsTab;
  label: string;
}

const TABS: TabSpec[] = [
  { id: 'revenue', label: 'Revenue Summary' },
  { id: 'payouts', label: 'Wallet / Payouts' },
  { id: 'royalty', label: 'Royalty & Commissions' },
];

export interface AccountsProps {
  userRole?: string;
}

export default function Accounts({ userRole = 'finance_admin' }: AccountsProps) {
  const [tab, setTab] = useState<AccountsTab>('revenue');

  const canCreatePayout = can(userRole, CAP.PAYOUT_CREATE);
  const canApprovePayout = can(userRole, CAP.PAYOUT_APPROVE);
  const canApproveRoyalty = can(userRole, CAP.ROYALTY_APPROVE);

  const body: Record<AccountsTab, ReactNode> = {
    revenue: <RevenueSummary />,
    payouts: <PayoutsTab canCreate={canCreatePayout} canApprove={canApprovePayout} />,
    royalty: <RoyaltyTab canApprove={canApproveRoyalty} />,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Accounts & Finance</h2>
        <p className="text-xs text-gray-500">
          Revenue summaries · wallet & agent payouts · monthly royalty and team commissions.
        </p>
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-6 min-w-max">
          {TABS.map((t) => (
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

      <div>{body[tab]}</div>
    </div>
  );
}
