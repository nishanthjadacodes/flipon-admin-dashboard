'use client';

import { useEffect, useMemo, useState } from 'react';
import { agentsAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';
import { downloadCsv } from '@/utils/csv';

interface AgentRecord {
  id: string;
  name?: string;
  mobile?: string;
  email?: string;
  is_active?: boolean;
  online_status?: boolean;
  is_kyc_verified?: boolean;
  kyc_submitted_at?: string | null;
  kyc_verified_at?: string | null;
  rating?: number;
  total_jobs_completed?: number;
  active_jobs?: number;
  activeBookings?: number;
  assigned_zone?: string;
  current_lat?: number | string;
  current_lng?: number | string;
  last_location_update?: string;
  referral_code?: string;
  is_priority_user?: boolean;
  royalty_forfeited_until?: string | null;
  royalty_forfeit_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

interface DutyState {
  label: 'inactive' | 'offline' | 'busy' | 'online';
  tone: string;
}

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};
const fmtRating = (r: unknown): string => {
  const n = Number(r);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) : '—';
};
const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');

// Short employee-style code shown in admin's rep details. MUST match
// what the rep app shows in its home hero + profile screen — see
// customerandroidapp/src/utils/agent/repCode.ts. Same derivation
// (first 4 hex chars of UUID, uppercased, with REP- prefix) so the
// rep can quote their code over the phone and admin recognises it
// immediately. Falls back to the explicit agent_code if the backend
// ever starts assigning one.
const repCode = (agent: { id?: unknown; agent_code?: string | null }): string => {
  if (agent.agent_code && String(agent.agent_code).trim()) {
    return String(agent.agent_code).trim();
  }
  const slug = String(agent.id || '')
    .replace(/-/g, '')
    .slice(0, 4)
    .toUpperCase();
  return slug ? `REP-${slug}` : 'REP-—';
};

function dutyState(agent: AgentRecord): DutyState {
  if (!agent.is_active) return { label: 'inactive', tone: 'bg-gray-200 text-gray-700' };
  if (!agent.online_status) return { label: 'offline', tone: 'bg-gray-100 text-gray-600' };
  // "Busy" = online and currently on an assignment.
  const activeJobs = Number(agent.active_jobs ?? agent.activeBookings ?? 0);
  if (activeJobs > 0) return { label: 'busy', tone: 'bg-amber-100 text-amber-800' };
  return { label: 'online', tone: 'bg-blue-100 text-blue-800' };
}

function StatusBadges({ agent }: { agent: AgentRecord }) {
  const duty = dutyState(agent);
  return (
    <div className="flex flex-wrap gap-1">
      {/* Account-approval badge — was previously labelled "active" /
          "inactive" which conflicted with the duty badge ("online" /
          "offline"). Admins read "active" as "currently working"
          when it actually meant "account approved". Renamed to
          "approved" / "deactivated" to remove the ambiguity. The
          duty badge below is the single source of truth for whether
          the rep is currently online. */}
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          agent.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
        }`}
      >
        {agent.is_active ? 'approved' : 'deactivated'}
      </span>
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${duty.tone}`}>
        {duty.label}
      </span>
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          agent.is_kyc_verified
            ? 'bg-emerald-100 text-emerald-800'
            : agent.kyc_submitted_at
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-600'
        }`}
      >
        KYC:{' '}
        {agent.is_kyc_verified
          ? 'verified'
          : agent.kyc_submitted_at
            ? 'submitted'
            : 'not submitted'}
      </span>
    </div>
  );
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'online';
type KycFilter = 'all' | 'verified' | 'pending';

export interface AgentManagementProps {
  userRole?: string;
}

export default function AgentManagement({ userRole = 'super_admin' }: AgentManagementProps) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selected, setSelected] = useState<AgentRecord | null>(null);

  // When the user taps "View & act", scroll the detail panel into
  // view. On mobile (single-column layout) it lives BELOW the agent
  // list, so without this the click felt like a no-op — state did
  // update but the panel was hundreds of pixels off-screen.
  const openAgent = (agent: AgentRecord): void => {
    setSelected(agent);
    if (typeof document === 'undefined') return;
    requestAnimationFrame(() => {
      const panel = document.getElementById('agent-detail-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterKyc, setFilterKyc] = useState<KycFilter>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Per PDF: only super_admin can create/deactivate agents and verify KYC.
  // Operations Manager can monitor (duty/location) but not approve.
  const canApprove = can(userRole, CAP.AGENT_APPROVE);
  const canKyc = can(userRole, CAP.AGENT_KYC);
  const canMonitor = can(userRole, CAP.AGENT_MONITOR);
  const canExport = userRole === 'super_admin';

  const exportAgents = (): void => {
    downloadCsv(`agents-${new Date().toISOString().slice(0, 10)}.csv`, agents, [
      { key: 'id', label: 'agent_id' },
      { key: 'name', label: 'name' },
      { key: 'mobile', label: 'mobile' },
      { key: 'email', label: 'email' },
      { key: 'is_active', label: 'is_active' },
      { key: 'online_status', label: 'online_status' },
      { key: 'is_kyc_verified', label: 'is_kyc_verified' },
      { key: 'rating', label: 'rating' },
      { key: 'total_jobs_completed', label: 'jobs_completed' },
      { key: 'assigned_zone', label: 'zone' },
      { key: 'referral_code', label: 'referral_code' },
      { key: 'created_at', label: 'joined_at' },
    ]);
  };

  const [retryKey, setRetryKey] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const buildParams = (): Record<string, string> => {
      const params: Record<string, string> = {};
      if (filterStatus === 'active') params.status = 'active';
      if (filterStatus === 'inactive') params.status = 'inactive';
      if (filterKyc === 'verified') params.kyc = 'verified';
      if (filterKyc === 'pending') params.kyc = 'pending';
      if (searchTerm.trim()) params.search = searchTerm.trim();
      return params;
    };

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await agentsAPI.getAll(buildParams());
        if (cancelled) return;
        let list: AgentRecord[] = Array.isArray(data) ? (data as AgentRecord[]) : [];
        if (filterStatus === 'online') list = list.filter((a) => a.online_status);
        setAgents(list);
        if (canMonitor && !cancelled) {
          timer = setInterval(silentRefresh, 30_000);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const silentRefresh = async (): Promise<void> => {
      try {
        const data = await agentsAPI.getAll(buildParams());
        if (cancelled) return;
        let list: AgentRecord[] = Array.isArray(data) ? (data as AgentRecord[]) : [];
        if (filterStatus === 'online') list = list.filter((a) => a.online_status);
        setAgents(list);
      } catch (e: any) {
        // Silent failure — keep existing data on screen rather than wiping it.
        console.warn('[AgentManagement] silent refresh failed:', e.message);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [filterStatus, filterKyc, searchTerm, canMonitor, retryKey]);

  const filteredAgents = agents; // server-side filtered; no extra client filter needed

  const stats = useMemo(() => {
    const total = agents.length;
    const online = agents.filter((a) => a.online_status).length;
    const active = agents.filter((a) => a.is_active).length;
    const pendingKyc = agents.filter((a) => !a.is_kyc_verified).length;
    return { total, online, active, pendingKyc };
  }, [agents]);

  const mutateLocal = (id: string, patch: Partial<AgentRecord>): void => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    if (selected && selected.id === id) setSelected((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSetActive = async (agent: AgentRecord, next: boolean): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await agentsAPI.setStatus(agent.id, { is_active: next });
      mutateLocal(agent.id, { is_active: next });
      setActionMsg(`${agent.name}: ${next ? 'approved / activated' : 'deactivated'}`);
    } catch (e: any) {
      setActionMsg(`Failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleVerifyKyc = async (
    agent: AgentRecord,
    status: 'verified' | 'rejected',
  ): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      // First try the formal KYC endpoint — works when the rep has actually
      // submitted KYC docs (AgentKyc row exists).
      await agentsAPI.verifyKyc(agent.id, { status });
      mutateLocal(agent.id, {
        is_kyc_verified: status === 'verified',
        kyc_verified_at: status === 'verified' ? new Date().toISOString() : null,
      });
      setActionMsg(`${agent.name}: KYC ${status}`);
    } catch (e: any) {
      // Guest reps and reps that haven't uploaded docs return 404 from the
      // formal endpoint. Fall back to a direct user-status flip so admins
      // can still mark trusted reps as verified for assignment.
      const looksLikeMissing =
        /not found|404/i.test(e?.message || '') || e?.status === 404;
      if (looksLikeMissing && status === 'verified') {
        try {
          await agentsAPI.setStatus(agent.id, {
            is_active: true,
            is_verified: true,
            is_kyc_verified: true,
          });
          mutateLocal(agent.id, {
            is_kyc_verified: true,
            is_active: true,
            kyc_verified_at: new Date().toISOString(),
          });
          setActionMsg(`${agent.name}: marked verified (no formal KYC submitted)`);
          return;
        } catch (e2: any) {
          setActionMsg(`KYC update failed: ${e2.message}`);
          return;
        }
      }
      setActionMsg(`KYC update failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  // ─── Governance handlers (Refer & Earn policy section 4) ─────────────
  const handleForfeitRoyalty = async (agent: AgentRecord): Promise<void> => {
    const reason = window.prompt(
      `Anti-poaching forfeit — ${agent.name}\n\nThe rep will lose all royalty earnings for the rest of the current quarter. Enter the evidence / reason (visible in the audit log):`,
    );
    if (!reason || !reason.trim()) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res: any = await agentsAPI.forfeitRoyalty(agent.id, reason.trim());
      const until = res?.data?.royalty_forfeited_until || null;
      mutateLocal(agent.id, {
        royalty_forfeited_until: until,
        royalty_forfeit_reason: reason.trim(),
      });
      setActionMsg(`${agent.name}: royalty forfeited until ${String(until || '').slice(0, 10)}`);
    } catch (e: any) {
      setActionMsg(`Forfeit failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleClearForfeit = async (agent: AgentRecord): Promise<void> => {
    if (!window.confirm(`Clear the royalty forfeit on ${agent.name}? They'll resume earning royalty next month.`)) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await agentsAPI.clearRoyaltyForfeit(agent.id);
      mutateLocal(agent.id, {
        royalty_forfeited_until: null,
        royalty_forfeit_reason: null,
      });
      setActionMsg(`${agent.name}: royalty forfeit cleared`);
    } catch (e: any) {
      setActionMsg(`Clear forfeit failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleTerminateSelfReferral = async (agent: AgentRecord): Promise<void> => {
    if (
      !window.confirm(
        `⚠️ Terminate ${agent.name}'s account for self-referral abuse?\n\n` +
          `This is PERMANENT:\n` +
          `• Account is deactivated immediately\n` +
          `• All pending referrals on either side are expired\n` +
          `• Royalty is forever forfeited\n\n` +
          `Only proceed if you have confirmed evidence of duplicate-account self-referral.`,
      )
    ) return;
    const reason = window.prompt('Enter the evidence / reason (audit log):');
    if (!reason || !reason.trim()) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await agentsAPI.terminateForSelfReferral(agent.id, reason.trim());
      mutateLocal(agent.id, {
        is_active: false,
        royalty_forfeited_until: '2099-12-31',
        royalty_forfeit_reason: `Self-referral violation: ${reason.trim()}`,
      });
      setActionMsg(`${agent.name}: TERMINATED for self-referral abuse`);
    } catch (e: any) {
      setActionMsg(`Termination failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Representative Management</h2>
          <p className="text-xs text-gray-500">
            {stats.total} total · {stats.online} online · {stats.pendingKyc} pending KYC
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && agents.length > 0 && (
            <button
              onClick={exportAgents}
              className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700"
              title="Download current representative list as CSV"
            >
              Export CSV
            </button>
          )}
          <div className="relative">
            <input
              type="text"
              placeholder="Search name / mobile / email"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="online">Online now</option>
          </select>
          <select
            value={filterKyc}
            onChange={(e) => setFilterKyc(e.target.value as KycFilter)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All KYC</option>
            <option value="verified">KYC verified</option>
            <option value="pending">KYC pending</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>
            Failed to load representatives: {error}
            <span className="block text-xs text-red-700 mt-1">
              The Render dyno may be cold — the first request can take 20–45 seconds. Try again.
            </span>
          </span>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {loading && agents.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
              Loading agents…
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
              No agents match the current filters.
            </div>
          ) : (
            filteredAgents.map((agent) => {
              const isSelected = selected?.id === agent.id;
              return (
                <div
                  key={agent.id}
                  className={`bg-white rounded-lg shadow p-5 border transition lift fade-in-up ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:shadow-md'
                  }`}
                >
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {agent.name || 'Unnamed agent'}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {shortId(agent.id)} · joined {fmtDate(agent.created_at)}
                      </p>
                    </div>
                    <StatusBadges agent={agent} />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">Contact</p>
                      <p className="text-gray-600">{agent.mobile || '—'}</p>
                      <p className="text-gray-600 truncate">{agent.email || 'no email on file'}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Performance</p>
                      <p className="text-gray-600">⭐ {fmtRating(agent.rating)} rating</p>
                      <p className="text-gray-600">{agent.total_jobs_completed ?? 0} jobs completed</p>
                    </div>
                  </div>

                  {agent.assigned_zone && (
                    <p className="text-xs text-gray-500 mt-2">Zone: {agent.assigned_zone}</p>
                  )}
                  {(agent.current_lat || agent.current_lng || agent.last_location_update) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {agent.current_lat && agent.current_lng ? (
                        <a
                          href={`https://www.google.com/maps?q=${agent.current_lat},${agent.current_lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {Number(agent.current_lat).toFixed(4)}, {Number(agent.current_lng).toFixed(4)} (map ↗)
                        </a>
                      ) : (
                        'Location not shared'
                      )}
                      {agent.last_location_update && (
                        <span className="text-gray-400">
                          {' '}
                          · last ping {fmtDate(agent.last_location_update)}
                        </span>
                      )}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => openAgent(agent)}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                    >
                      View & act
                    </button>
                    {canApprove && !agent.is_active && (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleSetActive(agent, true)}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    )}
                    {canApprove && agent.is_active && (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleSetActive(agent, false)}
                        className="px-3 py-1 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    )}
                    {canKyc && !agent.is_kyc_verified && (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleVerifyKyc(agent, 'verified')}
                        className="px-3 py-1 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Verify KYC
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div id="agent-detail-panel" className="space-y-6 scroll-mt-4">
          {!selected ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-sm text-gray-500">
              {canApprove
                ? 'Select an agent to see full details, approve onboarding, or manage KYC status.'
                : canMonitor
                  ? 'Select an agent to see duty status and performance. Your role is monitor-only.'
                  : 'Select an agent to see their profile.'}
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Representative Details</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">Name</p>
                    <p className="text-gray-600">{selected.name || '—'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Representative ID</p>
                    <p className="text-gray-900 font-mono text-sm font-semibold">
                      {repCode(selected as any)}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Internal ref: {shortId(selected.id)}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Contact</p>
                    <p className="text-gray-600">{selected.mobile || '—'}</p>
                    <p className="text-gray-600">{selected.email || 'no email on file'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Joined</p>
                    <p className="text-gray-600">{fmtDate(selected.created_at)}</p>
                  </div>
                  {selected.referral_code && (
                    <div>
                      <p className="font-medium text-gray-900">Referral code</p>
                      <p className="text-gray-600 font-mono text-xs">{selected.referral_code}</p>
                    </div>
                  )}
                  {selected.assigned_zone && (
                    <div>
                      <p className="font-medium text-gray-900">Assigned zone</p>
                      <p className="text-gray-600">{selected.assigned_zone}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">Rating</p>
                    <p className="text-lg font-semibold text-gray-900">⭐ {fmtRating(selected.rating)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Jobs completed</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {selected.total_jobs_completed ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Currently online</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {selected.online_status ? 'Yes' : 'No'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Last active</p>
                    <p className="text-sm text-gray-700">
                      {fmtDate(selected.last_location_update || selected.updated_at)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">KYC</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Submitted: {fmtDate(selected.kyc_submitted_at)} · Verified:{' '}
                  {fmtDate(selected.kyc_verified_at)}
                </p>
                {canKyc ? (
                  <div className="flex gap-2">
                    {!selected.is_kyc_verified ? (
                      <>
                        <button
                          disabled={actionBusy}
                          onClick={() => handleVerifyKyc(selected, 'verified')}
                          className="flex-1 px-3 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve KYC
                        </button>
                        <button
                          disabled={actionBusy}
                          onClick={() => handleVerifyKyc(selected, 'rejected')}
                          className="flex-1 px-3 py-2 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleVerifyKyc(selected, 'rejected')}
                        className="flex-1 px-3 py-2 border border-yellow-300 text-yellow-700 text-sm rounded hover:bg-yellow-50 disabled:opacity-50"
                      >
                        Revoke verification
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    KYC actions are restricted to Super Admin. Your role can only monitor agent
                    status.
                  </p>
                )}
              </div>

              {canApprove && (
                <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Account status</h3>
                  <div className="flex gap-2">
                    {selected.is_active ? (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleSetActive(selected, false)}
                        className="flex-1 px-3 py-2 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        Deactivate agent
                      </button>
                    ) : (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleSetActive(selected, true)}
                        className="flex-1 px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve / reactivate
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Payout details live in the Accounts section.
                  </p>
                </div>
              )}

              {/* Governance — anti-poaching + self-referral termination per the
                  Refer & Earn policy section 4. Gated on canApprove (super
                  admin only) since the actions take money / accounts away. */}
              {canApprove && (
                <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Royalty Governance
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">
                    Anti-poaching forfeits and self-referral termination. All
                    actions are audit-logged.
                  </p>

                  {/* Active forfeit banner */}
                  {selected.royalty_forfeited_until && (
                    <div className="mb-3 p-3 rounded border border-amber-300 bg-amber-50 text-xs">
                      <p className="font-semibold text-amber-900">
                        ⚠ Royalty forfeited until{' '}
                        {String(selected.royalty_forfeited_until).slice(0, 10)}
                      </p>
                      {selected.royalty_forfeit_reason && (
                        <p className="text-amber-800 mt-1">
                          Reason: {selected.royalty_forfeit_reason}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {selected.royalty_forfeited_until ? (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleClearForfeit(selected)}
                        className="px-3 py-2 border border-emerald-300 text-emerald-700 text-sm rounded hover:bg-emerald-50 disabled:opacity-50"
                      >
                        ↩️ Clear royalty forfeit
                      </button>
                    ) : (
                      <button
                        disabled={actionBusy}
                        onClick={() => handleForfeitRoyalty(selected)}
                        className="px-3 py-2 border border-amber-400 text-amber-700 text-sm rounded hover:bg-amber-50 disabled:opacity-50"
                      >
                        🚫 Forfeit royalty (this quarter)
                      </button>
                    )}
                    <button
                      disabled={actionBusy}
                      onClick={() => handleTerminateSelfReferral(selected)}
                      className="px-3 py-2 border-2 border-red-400 text-red-700 text-sm rounded hover:bg-red-50 disabled:opacity-50 font-semibold"
                    >
                      🛑 Terminate (self-referral abuse)
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                    Forfeit pauses royalty for the current calendar quarter.
                    Termination is permanent — deactivates the account and
                    expires every pending referral on either side.
                  </p>
                </div>
              )}

              {canMonitor && !canApprove && (
                <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Duty status monitoring</h3>
                  <p className="text-sm">
                    Currently{' '}
                    <span
                      className={`font-semibold ${
                        dutyState(selected).label === 'busy'
                          ? 'text-amber-700'
                          : dutyState(selected).label === 'online'
                            ? 'text-blue-700'
                            : 'text-gray-600'
                      }`}
                    >
                      {dutyState(selected).label}
                    </span>
                  </p>
                  {(selected.current_lat || selected.current_lng) && (
                    <p className="text-xs text-gray-600 mt-1">
                      <a
                        href={`https://www.google.com/maps?q=${selected.current_lat},${selected.current_lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Live location on map ↗
                      </a>
                      {selected.last_location_update && (
                        <span className="text-gray-400">
                          {' '}
                          · last ping {fmtDate(selected.last_location_update)}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-3">
                    Your role can monitor duty/location but not approve, deactivate, or verify
                    KYC — escalate to Super Admin if action is needed.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
