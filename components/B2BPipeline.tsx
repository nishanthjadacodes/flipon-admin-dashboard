'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { b2bAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';

// Mirrors the PDF's "Application → Inspection → NOC Issued" milestone flow.
type StageKey =
  | 'application_submitted'
  | 'under_review'
  | 'inspection'
  | 'noc_issued'
  | 'completed'
  | 'cancelled';

type Milestone = 'application_submitted' | 'under_review' | 'inspection' | 'noc_issued' | null;

interface Stage {
  key: StageKey;
  label: string;
  milestone: Milestone;
  tone: string;
}

const STAGES: Stage[] = [
  { key: 'application_submitted', label: 'Application Submitted', milestone: 'application_submitted', tone: 'bg-gray-50 border-gray-200' },
  { key: 'under_review',          label: 'Under Review',          milestone: 'under_review',          tone: 'bg-yellow-50 border-yellow-200' },
  { key: 'inspection',            label: 'Inspection',             milestone: 'inspection',            tone: 'bg-blue-50 border-blue-200' },
  { key: 'noc_issued',            label: 'NOC Issued',             milestone: 'noc_issued',            tone: 'bg-emerald-50 border-emerald-200' },
  { key: 'completed',             label: 'Completed',              milestone: null,                    tone: 'bg-green-50 border-green-200' },
  { key: 'cancelled',             label: 'Cancelled',              milestone: null,                    tone: 'bg-red-50 border-red-200' },
];

const money = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `₹${n.toLocaleString('en-IN')}` : '—';
};
const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};
const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');

interface CustomerLite {
  name?: string;
  email?: string;
}

interface CompanyLite {
  legal_entity_name?: string;
  gstin?: string;
}

interface SubmissionDetails {
  milestone?: string;
  milestone_note?: string;
}

interface PipelineRecord {
  id: string;
  kind?: 'enquiry' | 'booking';
  status?: string;
  service?: { name?: string };
  customer?: CustomerLite;
  company?: CompanyLite;
  price_quoted?: number;
  final_price?: number;
  created_at?: string;
  urgency?: string;
  submission_details?: SubmissionDetails;
}

type StagesMap = Partial<Record<StageKey, PipelineRecord[]>>;

type BillingCycle = 'one_time' | 'monthly' | 'quarterly' | 'half_yearly' | 'annual';

interface QuoteForm {
  service_fee: string | number;
  govt_fees: string;
  cycle: BillingCycle;
  valid_until: string;
  terms: string;
}

// ─── EnquiryActionPanel ────────────────────────────────────────────────────
interface EnquiryActionPanelProps {
  enquiry: PipelineRecord;
  canUpdate: boolean;
  onUpdated?: () => void;
  onMessage?: (msg: string) => void;
}

function EnquiryActionPanel({ enquiry, canUpdate, onUpdated, onMessage }: EnquiryActionPanelProps) {
  const [form, setForm] = useState<QuoteForm>({
    service_fee: enquiry.price_quoted || '',
    govt_fees: '',
    cycle: 'one_time',
    valid_until: '',
    terms: '',
  });
  const [rejectReason, setRejectReason] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const update = <K extends keyof QuoteForm>(k: K, v: QuoteForm[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  const submitQuote = async (e?: FormEvent<HTMLFormElement>): Promise<void> => {
    e?.preventDefault?.();
    setErr(null);
    if (!form.service_fee || Number.isNaN(Number(form.service_fee))) {
      setErr('Service fee (₹) is required.');
      return;
    }
    setBusy(true);
    try {
      await b2bAPI.issueQuote(enquiry.id, {
        service_fee: Number(form.service_fee),
        govt_fees: form.govt_fees === '' ? 0 : Number(form.govt_fees),
        cycle: form.cycle,
        valid_until: form.valid_until || null,
        terms: form.terms || null,
      });
      onMessage?.(
        `Quote sent to ${enquiry.customer?.name || 'customer'} — they'll see it in their app.`,
      );
      onUpdated?.();
    } catch (e2: any) {
      setErr(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async (): Promise<void> => {
    if (!rejectReason.trim()) {
      setErr('Please enter a reason before rejecting.');
      return;
    }
    if (!confirm(`Reject this enquiry? The customer will be notified.`)) return;
    setErr(null);
    setBusy(true);
    try {
      await b2bAPI.rejectEnquiry(enquiry.id, { reason: rejectReason.trim() });
      onMessage?.(`Enquiry ${shortId(enquiry.id)} rejected. Customer notified.`);
      onUpdated?.();
    } catch (e2: any) {
      setErr(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  const isPending = enquiry.status === 'pending';
  const isQuoted = enquiry.status === 'quoted';
  const isRejected = enquiry.status === 'rejected';

  if (!canUpdate) {
    return (
      <p className="text-xs text-gray-500 border-t pt-4">Your role is read-only for enquiries.</p>
    );
  }

  return (
    <div className="border-t pt-4 space-y-4">
      {/* Status context strip */}
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
        <p className="font-semibold">📝 Industrial enquiry — {enquiry.status}</p>
        <p className="mt-1 text-[11px]">
          {isPending &&
            "The customer is waiting for a quote. Fill in the fee + terms below and press Send Quote — they'll get an in-app push."}
          {isQuoted &&
            'Quote already sent. Waiting for customer to accept. You can revise below if needed.'}
          {isRejected && 'This enquiry is marked rejected. The customer has been notified.'}
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">{err}</div>
      )}

      {!isRejected && (
        <form onSubmit={submitQuote} className="space-y-3">
          <p className="text-sm font-semibold text-gray-900">
            {isQuoted ? 'Revise quote' : 'Issue quote'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs block">
              <span className="block text-gray-700 mb-1">Service fee ₹ (required)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.service_fee}
                onChange={(e) => update('service_fee', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="text-xs block">
              <span className="block text-gray-700 mb-1">Govt. fees ₹ (as per actuals)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.govt_fees}
                onChange={(e) => update('govt_fees', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="text-xs block">
              <span className="block text-gray-700 mb-1">Billing cycle</span>
              <select
                value={form.cycle}
                onChange={(e) => update('cycle', e.target.value as BillingCycle)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="one_time">One-time</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="half_yearly">Half-yearly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="text-xs block">
              <span className="block text-gray-700 mb-1">Quote valid until</span>
              <input
                type="date"
                value={form.valid_until}
                onChange={(e) => update('valid_until', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
          <label className="text-xs block">
            <span className="block text-gray-700 mb-1">Terms / scope / payment policy</span>
            <textarea
              rows={3}
              value={form.terms}
              onChange={(e) => update('terms', e.target.value)}
              placeholder={
                'e.g. 50% advance, balance on completion. Govt. fees at actuals. ' +
                'Includes 2 portal revisions. Urgent 24-hour surcharge 25%.'
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-white text-sm rounded disabled:opacity-50 font-semibold"
              style={{ backgroundColor: 'var(--brand-primary)' }}
            >
              {busy ? 'Sending…' : isQuoted ? 'Re-send quote' : 'Send Quote to Customer'}
            </button>
          </div>
        </form>
      )}

      {!isRejected && (
        <div className="pt-4 border-t border-dashed">
          <p className="text-sm font-semibold text-gray-900 mb-2">Or reject this enquiry</p>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason the customer will see (e.g. 'Outside our service area')"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={submitReject}
              className="px-4 py-2 border border-red-300 text-red-700 text-sm rounded hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface B2BPipelineProps {
  userRole?: string;
}

export default function B2BPipeline({ userRole = 'b2b_admin' }: B2BPipelineProps) {
  const [stages, setStages] = useState<StagesMap | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<PipelineRecord | null>(null);
  const [milestoneNote, setMilestoneNote] = useState<string>('');
  const [retryKey, setRetryKey] = useState<number>(0);

  const canUpdate = can(userRole, CAP.B2B_PIPELINE_UPDATE);

  const openCard = (b: PipelineRecord): void => {
    setSelected(b);
    setTimeout(() => {
      const el =
        typeof document !== 'undefined' ? document.getElementById('b2b-detail-panel') : null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await b2bAPI.getPipeline();
        if (!cancelled) setStages(data && typeof data === 'object' ? (data as StagesMap) : {});
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
  }, [retryKey]);

  const totals = useMemo(() => {
    if (!stages) return { total: 0, completed: 0, cancelled: 0 };
    let t = 0;
    Object.values(stages).forEach((arr) => {
      if (Array.isArray(arr)) t += arr.length;
    });
    return {
      total: t,
      completed: stages.completed?.length || 0,
      cancelled: stages.cancelled?.length || 0,
    };
  }, [stages]);

  const moveToMilestone = async (booking: PipelineRecord, stage: Stage): Promise<void> => {
    if (!stage.milestone) return; // completed/cancelled are terminal
    const note = milestoneNote.trim() || undefined;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const resp: any = await b2bAPI.updateMilestone(booking.id, {
        milestone: stage.milestone,
        note,
      });
      const notif = resp?.notification;
      const parts = [`Moved ${shortId(booking.id)} → ${stage.label}`];
      if (notif) {
        if (notif.push?.success) {
          parts.push('Customer notified (push delivered).');
        } else if (notif.push?.message) {
          parts.push(`Push: ${notif.push.message}`);
        } else if (notif.socket) {
          parts.push('Live socket event sent; no push token on file.');
        } else {
          parts.push('Customer not reachable — no push token registered.');
        }
      }
      setActionMsg(parts.join(' · '));
      setMilestoneNote('');
      setRetryKey((k) => k + 1);
    } catch (e: any) {
      setActionMsg(`Failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">B2B / Industrial Pipeline</h2>
          <p className="text-xs text-gray-500">
            {loading
              ? 'Loading pipeline…'
              : `${totals.total} industrial file${totals.total === 1 ? '' : 's'} · ${totals.completed} completed · ${totals.cancelled} cancelled`}
            {!canUpdate && ' · read-only for your role'}
          </p>
        </div>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>Failed to load pipeline: {error}</span>
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

      {stages && totals.total === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-sm text-blue-900">
          <p className="font-semibold mb-1">No industrial files in the pipeline yet.</p>
          <p className="text-xs text-blue-800">
            Once a customer submits an industrial enquiry and it&apos;s converted to a booking, it will
            show up here under <span className="font-medium">Application Submitted</span>. Click any
            card to reveal the milestone controls — the{' '}
            <span className="font-medium">
              Move to Under Review / Inspection / NOC Issued
            </span>{' '}
            buttons are inside the detail panel that opens below the kanban.
          </p>
        </div>
      )}

      {stages && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {STAGES.map((stage) => {
            const rows: PipelineRecord[] = Array.isArray(stages[stage.key])
              ? (stages[stage.key] as PipelineRecord[])
              : [];
            return (
              <div key={stage.key} className={`border rounded-lg ${stage.tone}`}>
                <div className="px-4 py-2 border-b border-black/5 flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900 text-sm">{stage.label}</h4>
                  <span className="text-xs text-gray-600">{rows.length}</span>
                </div>
                <div className="p-3 space-y-2 min-h-[120px]">
                  {rows.length === 0 ? (
                    <p className="text-xs text-gray-500">—</p>
                  ) : (
                    rows.map((b) => {
                      const isEnquiry = b.kind === 'enquiry';
                      return (
                        <button
                          key={`${b.kind || 'booking'}-${b.id}`}
                          onClick={() => openCard(b)}
                          className={`w-full text-left bg-white border ${
                            selected?.id === b.id
                              ? 'border-blue-500 ring-2 ring-blue-200'
                              : 'border-gray-200'
                          } rounded p-2 hover:shadow hover:border-blue-300 transition group`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {b.service?.name || 'Service'}
                            </p>
                            <span
                              className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-sm shrink-0 ${
                                isEnquiry
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-blue-100 text-blue-800 border border-blue-300'
                              }`}
                            >
                              {isEnquiry ? 'Enquiry' : 'Booking'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">
                            {b.customer?.name || '—'}
                            {b.company?.legal_entity_name ? ` · ${b.company.legal_entity_name}` : ''}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate">{shortId(b.id)}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-gray-500">
                              {money(b.price_quoted || b.final_price)} · {fmtDate(b.created_at)}
                            </p>
                            {canUpdate && (
                              <span className="text-[10px] text-blue-600 opacity-0 group-hover:opacity-100 transition">
                                Open ↓
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div
          id="b2b-detail-panel"
          className="bg-white border-2 border-blue-400 rounded-lg p-6 scroll-mt-24"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selected.service?.name || 'Industrial file'}
                </h3>
                <span
                  className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                    selected.kind === 'enquiry'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-blue-100 text-blue-800 border border-blue-300'
                  }`}
                >
                  {selected.kind === 'enquiry' ? 'Enquiry' : 'Booking'}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-mono">{selected.id}</p>
              <p className="text-xs text-gray-500 mt-1">
                Customer: {selected.customer?.name || '—'}
                {selected.customer?.email ? ` · ${selected.customer.email}` : ''}
                {selected.company?.legal_entity_name
                  ? ` · ${selected.company.legal_entity_name}`
                  : ''}
                {selected.company?.gstin ? ` (GSTIN ${selected.company.gstin})` : ''}
              </p>
              {selected.urgency && selected.urgency !== 'standard' && (
                <p className="text-xs text-red-600 mt-1 font-semibold uppercase">
                  ⚡ {selected.urgency}
                </p>
              )}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              ✕ close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <p className="font-medium text-gray-900">Status</p>
              <p className="text-gray-600 capitalize">
                {(selected.status || '').replace('_', ' ')}
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-900">Quote</p>
              <p className="text-gray-600">{money(selected.price_quoted || selected.final_price)}</p>
            </div>
            {selected.submission_details?.milestone && (
              <div className="md:col-span-2">
                <p className="font-medium text-gray-900">Current milestone</p>
                <p className="text-gray-600 capitalize">
                  {(selected.submission_details.milestone || '').replace(/_/g, ' ')}
                </p>
                {selected.submission_details.milestone_note && (
                  <p className="text-xs text-gray-500 mt-1">
                    Note: {selected.submission_details.milestone_note}
                  </p>
                )}
              </div>
            )}
          </div>

          {selected.kind === 'enquiry' ? (
            <EnquiryActionPanel
              enquiry={selected}
              canUpdate={canUpdate}
              onUpdated={() => setRetryKey((k) => k + 1)}
              onMessage={setActionMsg}
            />
          ) : canUpdate ? (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-semibold text-gray-900">🚩 Milestone controls</p>
              <input
                type="text"
                value={milestoneNote}
                onChange={(e) => setMilestoneNote(e.target.value)}
                placeholder="Optional note sent to the customer with this milestone update"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {STAGES.filter((s) => s.milestone).map((s) => (
                  <button
                    key={s.key}
                    disabled={actionBusy}
                    onClick={() => moveToMilestone(selected, s)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >
                    Move to {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-500">
                Every move is audit-logged and triggers an automated push notification to the
                customer&apos;s app.
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Your role is read-only for pipeline changes.</p>
          )}
        </div>
      )}
    </div>
  );
}
