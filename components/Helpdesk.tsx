'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { helpdeskAPI, adminAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';
import { downloadCsv } from '@/utils/csv';
import { useModalBackClose } from '@/utils/useModalBackClose';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

const STATUS_OPTIONS: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITY_OPTIONS: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');
const money = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `₹${n.toLocaleString('en-IN')}` : '—';
};

const STATUS_TONE: Record<TicketStatus, string> = {
  open: 'bg-red-100 text-red-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-200 text-gray-700',
};
const PRIORITY_TONE: Record<TicketPriority, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
};
const BOOKING_TONE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  accepted: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-blue-100 text-blue-800',
  documents_collected: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

interface CustomerRecord {
  id: string;
  name?: string;
  mobile?: string;
  email?: string;
  is_active?: boolean;
  is_verified?: boolean;
  created_at?: string;
}

interface BookingLite {
  id: string;
  status?: string;
  booking_type?: string;
  service?: { name?: string };
  created_at?: string;
  final_price?: number;
  price_quoted?: number;
}

interface TicketRecord {
  id: string;
  subject: string;
  description?: string;
  status: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  resolution_note?: string;
  customer_id?: string;
  customer?: CustomerRecord | null;
  booking?: BookingLite | null;
  created_at?: string;
  resolved_at?: string;
}

interface ChatMessage {
  id: string;
  body: string;
  sender_role?: string;
  sender_name?: string;
  created_at?: string;
}

interface CreateTicketPayload {
  subject: string;
  description: string | null;
  priority: TicketPriority;
  category: string;
  customer_id: string | null;
}

interface CreateTicketModalProps {
  customers: CustomerRecord[];
  onClose: () => void;
  onCreate: (payload: CreateTicketPayload) => Promise<void>;
  busy: boolean;
}

interface CreateTicketFormState {
  subject: string;
  description: string;
  priority: TicketPriority;
  category: string;
  customer_id: string;
}

function CreateTicketModal({ customers, onClose, onCreate, busy }: CreateTicketModalProps) {
  // Browser back closes the modal instead of leaving the helpdesk page.
  useModalBackClose(true, onClose);
  const [form, setForm] = useState<CreateTicketFormState>({
    subject: '',
    description: '',
    priority: 'medium',
    category: 'general',
    customer_id: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const update = <K extends keyof CreateTicketFormState>(k: K, v: CreateTicketFormState[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErr(null);
    if (!form.subject.trim()) {
      setErr('Subject is required.');
      return;
    }
    try {
      await onCreate({
        subject: form.subject.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        category: form.category,
        customer_id: form.customer_id || null,
      });
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
        <h3 className="text-lg font-semibold text-gray-900">Create help ticket</h3>
        {err && (
          <div className="p-2 text-sm rounded bg-red-50 border border-red-200 text-red-800">
            {err}
          </div>
        )}
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Subject</span>
          <input
            required
            type="text"
            value={form.subject}
            onChange={(e) => update('subject', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Customer</span>
          <select
            value={form.customer_id}
            onChange={(e) => update('customer_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">(internal / unlinked)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || 'Unnamed'} · {c.mobile || shortId(c.id)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Priority</span>
            <select
              value={form.priority}
              onChange={(e) => update('priority', e.target.value as TicketPriority)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Category</span>
            <select
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="general">general</option>
              <option value="booking">booking</option>
              <option value="payment">payment</option>
              <option value="agent">representative</option>
              <option value="documents">documents</option>
              <option value="complaint">complaint</option>
            </select>
          </label>
        </div>
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Description</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create ticket'}
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

interface TicketChatPanelProps {
  ticket: TicketRecord;
  canSend: boolean;
}

function TicketChatPanel({ ticket, canSend }: TicketChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await helpdeskAPI.getTicketMessages(ticket.id);
      setMessages(Array.isArray(data) ? (data as ChatMessage[]) : []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ticket.id]);

  const handleSend = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const msg = await helpdeskAPI.sendTicketMessage(ticket.id, body);
      setMessages((prev) => [...prev, msg as ChatMessage]);
      setDraft('');
    } catch (err: any) {
      alert(`Send failed: ${err?.message || String(err)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">In-app chat</h3>
        <button
          onClick={load}
          className="text-xs text-blue-600 hover:underline"
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      <div className="border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto space-y-2 bg-gray-50 mb-3">
        {loading && messages.length === 0 ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : error ? (
          <p className="text-xs text-red-700">{error}</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-gray-500">
            No messages yet. Send one to start the conversation.
          </p>
        ) : (
          messages.map((m) => {
            const fromAdmin = ['super_admin', 'operations_manager', 'customer_support', 'support'].includes(
              m.sender_role || '',
            );
            return (
              <div key={m.id} className={`flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-lg p-2 text-sm ${
                    fromAdmin
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  <p
                    className={`text-[10px] mb-0.5 ${
                      fromAdmin ? 'text-blue-100' : 'text-gray-500'
                    }`}
                  >
                    {m.sender_name || (fromAdmin ? 'Support' : 'Customer')} ·{' '}
                    {fmtDate(m.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      {canSend ? (
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message to the customer…"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : (
        <p className="text-xs text-gray-500">Your role is read-only for this thread.</p>
      )}
      <p className="text-[10px] text-gray-500 mt-2">
        Messages are pushed to the customer&apos;s app as a notification.
      </p>
    </div>
  );
}

interface CustomerDetailPanelProps {
  customer: CustomerRecord;
  canManage: boolean;
  onCustomerMutated?: (next: CustomerRecord) => void;
}

function CustomerDetailPanel({
  customer,
  canManage,
  onCustomerMutated,
}: CustomerDetailPanelProps) {
  const [bookings, setBookings] = useState<BookingLite[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [localCustomer, setLocalCustomer] = useState<CustomerRecord>(customer);

  useEffect(() => {
    setLocalCustomer(customer);
  }, [customer]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await helpdeskAPI.getCustomerBookings(customer.id);
        if (!cancelled) setBookings(Array.isArray(data) ? (data as BookingLite[]) : []);
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
  }, [customer.id]);

  const handleSetActive = async (next: boolean): Promise<void> => {
    if (!canManage) return;
    if (
      !next &&
      !confirm(
        `Deactivate ${localCustomer.name || localCustomer.mobile}? They will lose access to the customer app until reactivated.`,
      )
    )
      return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await adminAPI.setUserStatus(localCustomer.id, { is_active: next });
      const updated: CustomerRecord = { ...localCustomer, is_active: next };
      setLocalCustomer(updated);
      onCustomerMutated?.(updated);
      setActionMsg(next ? 'Customer reactivated' : 'Customer deactivated');
    } catch (e: any) {
      setActionMsg(`Failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Customer details</h3>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              localCustomer.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {localCustomer.is_active ? 'active' : 'inactive'}
          </span>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-gray-900">Name</p>
            <p className="text-gray-600">{localCustomer.name || '—'}</p>
          </div>
          <div>
            <p className="font-medium text-gray-900">ID</p>
            <p className="text-gray-600 font-mono text-xs break-all">{localCustomer.id}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-medium text-gray-900">Mobile</p>
              <p className="text-gray-600">{localCustomer.mobile || '—'}</p>
            </div>
            <div>
              <p className="font-medium text-gray-900">Email</p>
              <p className="text-gray-600 truncate">{localCustomer.email || 'no email on file'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-medium text-gray-900">Joined</p>
              <p className="text-gray-600">{fmtDate(localCustomer.created_at)}</p>
            </div>
            <div>
              <p className="font-medium text-gray-900">Verified</p>
              <p className="text-gray-600">{localCustomer.is_verified ? 'Yes' : 'No'}</p>
            </div>
          </div>
        </div>

        {canManage && (
          <div className="mt-4 pt-4 border-t">
            {actionMsg && <p className="text-xs mb-2 text-blue-800">{actionMsg}</p>}
            {localCustomer.is_active ? (
              <button
                disabled={actionBusy}
                onClick={() => handleSetActive(false)}
                className="w-full px-3 py-2 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-50"
              >
                Deactivate customer account
              </button>
            ) : (
              <button
                disabled={actionBusy}
                onClick={() => handleSetActive(true)}
                className="w-full px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
              >
                Reactivate customer account
              </button>
            )}
            <p className="text-[10px] text-gray-500 mt-2">
              Deactivating revokes access to the customer app. Action audit-logged.
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Booking history{' '}
          {bookings.length > 0 && (
            <span className="text-xs text-gray-500">({bookings.length})</span>
          )}
        </h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading bookings…</p>
        ) : error ? (
          <p className="text-sm text-red-700">Failed: {error}</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-gray-500">No bookings on record for this customer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Ref</th>
                  <th className="text-left py-2">Service</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b">
                    <td className="py-2 font-mono text-xs">{shortId(b.id)}</td>
                    <td className="py-2">{b.service?.name || '—'}</td>
                    <td className="py-2">{fmtDate(b.created_at)}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          BOOKING_TONE[b.status || ''] || 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {(b.status || '').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2">{money(b.final_price || b.price_quoted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export interface HelpdeskProps {
  userRole?: string;
}

export default function Helpdesk({ userRole = 'super_admin' }: HelpdeskProps) {
  const canTicketCreate = can(userRole, CAP.TICKET_CREATE);
  const canTicketUpdate = can(userRole, CAP.TICKET_UPDATE);
  const canCustomerView = can(userRole, CAP.CUSTOMER_VIEW);
  const canExportCustomers = userRole === 'super_admin';

  const [activeTab, setActiveTab] = useState<'tickets' | 'customers'>('tickets');
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | TicketStatus>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const [t, c] = await Promise.all([
          helpdeskAPI.getTickets({ limit: 100 }),
          canCustomerView ? helpdeskAPI.getCustomers({ limit: 200 }) : Promise.resolve([]),
        ]);
        setTickets(Array.isArray(t) ? (t as TicketRecord[]) : []);
        setCustomers(Array.isArray(c) ? (c as CustomerRecord[]) : []);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [canCustomerView]);

  useEffect(() => {
    if (!canCustomerView && activeTab === 'customers') setActiveTab('tickets');
  }, [canCustomerView, activeTab]);

  const filteredTickets = useMemo<TicketRecord[]>(() => {
    const q = searchTerm.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (!q) return true;
      return (
        (t.subject || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.customer?.name || '').toLowerCase().includes(q) ||
        String(t.id || '').toLowerCase().includes(q)
      );
    });
  }, [tickets, filterStatus, searchTerm]);

  const filteredCustomers = useMemo<CustomerRecord[]>(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.mobile || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q),
    );
  }, [customers, searchTerm]);

  const handleCreate = async (payload: CreateTicketPayload): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const created = await helpdeskAPI.createTicket(payload as unknown as Record<string, unknown>);
      if (created && typeof created === 'object') {
        const c = created as TicketRecord;
        const enriched: TicketRecord = {
          ...c,
          customer: customers.find((cu) => cu.id === c.customer_id) || null,
        };
        setTickets((prev) => [enriched, ...prev]);
      }
      setShowCreate(false);
      setActionMsg('Ticket created');
    } catch (e: any) {
      setActionMsg(`Create failed: ${e.message}`);
      throw e;
    } finally {
      setActionBusy(false);
    }
  };

  const updateTicket = async (
    ticket: TicketRecord,
    patch: Partial<TicketRecord>,
  ): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const updated = await helpdeskAPI.updateTicket(ticket.id, patch as Record<string, unknown>);
      const mergedRow: TicketRecord =
        updated && typeof updated === 'object'
          ? { ...ticket, ...(updated as Partial<TicketRecord>) }
          : { ...ticket, ...patch };
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? mergedRow : t)));
      if (selectedTicket?.id === ticket.id) setSelectedTicket(mergedRow);
      setActionMsg(`Ticket updated: ${Object.keys(patch).join(', ')}`);
    } catch (e: any) {
      setActionMsg(`Update failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Customer Support</h2>
          <p className="text-xs text-gray-500">Tickets, customer lookup, and chat history.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTicketCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + Create ticket
            </button>
          )}
          <div className="relative">
            <input
              type="text"
              placeholder="Search subject / customer / mobile"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          {activeTab === 'tickets' && (
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | TicketStatus)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('tickets')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tickets'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Help tickets ({tickets.length})
          </button>
          {canCustomerView && (
            <button
              onClick={() => setActiveTab('customers')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'customers'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Customers ({customers.length})
            </button>
          )}
        </nav>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          Failed to load helpdesk data: {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      {activeTab === 'tickets' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {loading && tickets.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
                Loading tickets…
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
                No tickets match the current filters. Create one from the header to get started.
              </div>
            ) : (
              filteredTickets.map((t) => {
                const isSelected = selectedTicket?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTicket(t)}
                    className={`bg-white rounded-lg shadow p-5 border cursor-pointer transition lift fade-in-up ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-gray-900">{t.subject}</h3>
                        <p className="text-xs text-gray-500">
                          {shortId(t.id)} · {t.customer?.name || 'Unlinked'} ·{' '}
                          {fmtDate(t.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_TONE[t.status] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {(t.status || '').replace('_', ' ')}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            (t.priority && PRIORITY_TONE[t.priority]) || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {t.priority}
                        </span>
                        {t.category && (
                          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-xs rounded-full">
                            {t.category}
                          </span>
                        )}
                      </div>
                    </div>
                    {t.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">{t.description}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-6">
            {!selectedTicket ? (
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-sm text-gray-500">
                Select a ticket to see full details, change its status, or leave a resolution note.
              </div>
            ) : (
              <>
                <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Ticket details</h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">Subject</p>
                      <p className="text-gray-600">{selectedTicket.subject}</p>
                    </div>
                    {selectedTicket.description && (
                      <div>
                        <p className="font-medium text-gray-900">Description</p>
                        <p className="text-gray-600 whitespace-pre-wrap">
                          {selectedTicket.description}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">Ticket ID</p>
                      <p className="text-gray-600 font-mono text-xs break-all">
                        {selectedTicket.id}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Customer</p>
                      {selectedTicket.customer ? (
                        <>
                          <p className="text-gray-600">{selectedTicket.customer.name}</p>
                          <p className="text-gray-600">{selectedTicket.customer.mobile}</p>
                          {selectedTicket.customer.email && (
                            <p className="text-gray-600 text-xs">{selectedTicket.customer.email}</p>
                          )}
                          <div className="flex gap-2 mt-2">
                            {selectedTicket.customer.mobile && (
                              <a
                                href={`tel:${selectedTicket.customer.mobile}`}
                                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                              >
                                📞 Call
                              </a>
                            )}
                            {selectedTicket.customer.email && (
                              <a
                                href={`mailto:${selectedTicket.customer.email}?subject=Re: ${encodeURIComponent(selectedTicket.subject || 'Support ticket')}`}
                                className="px-2 py-1 text-xs bg-gray-800 text-white rounded hover:bg-gray-700"
                              >
                                ✉ Email
                              </a>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-gray-500">Not linked to a customer record</p>
                      )}
                    </div>
                    {selectedTicket.booking && (
                      <div>
                        <p className="font-medium text-gray-900">Related booking</p>
                        <p className="text-gray-600 font-mono text-xs">
                          {shortId(selectedTicket.booking.id)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {selectedTicket.booking.booking_type} · {selectedTicket.booking.status}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">Created</p>
                      <p className="text-gray-600">{fmtDate(selectedTicket.created_at)}</p>
                      {selectedTicket.resolved_at && (
                        <p className="text-xs text-gray-500">
                          Resolved: {fmtDate(selectedTicket.resolved_at)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <TicketChatPanel ticket={selectedTicket} canSend={canTicketUpdate} />

                {canTicketUpdate ? (
                  <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Update</h3>
                    <label className="text-sm block mb-3">
                      <span className="block text-gray-700 mb-1">Status</span>
                      <select
                        value={selectedTicket.status}
                        disabled={actionBusy}
                        onChange={(e) =>
                          updateTicket(selectedTicket, { status: e.target.value as TicketStatus })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm block mb-3">
                      <span className="block text-gray-700 mb-1">Priority</span>
                      <select
                        value={selectedTicket.priority || 'medium'}
                        disabled={actionBusy}
                        onChange={(e) =>
                          updateTicket(selectedTicket, {
                            priority: e.target.value as TicketPriority,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm block">
                      <span className="block text-gray-700 mb-1">Resolution note</span>
                      <textarea
                        rows={3}
                        defaultValue={selectedTicket.resolution_note || ''}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (selectedTicket.resolution_note || '')) {
                            updateTicket(selectedTicket, { resolution_note: v || undefined });
                          }
                        }}
                        disabled={actionBusy}
                        placeholder="Leave a note (saves on blur)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-xs text-gray-500">
                    Your role can view tickets but not modify status or add resolution notes.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'customers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {canExportCustomers && customers.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    downloadCsv<CustomerRecord>(
                      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
                      customers,
                      [
                        { key: 'id', label: 'customer_id' },
                        { key: 'name', label: 'name' },
                        { key: 'mobile', label: 'mobile' },
                        { key: 'email', label: 'email' },
                        { key: 'is_active', label: 'is_active' },
                        { key: 'is_verified', label: 'is_verified' },
                        { key: 'created_at', label: 'joined_at' },
                      ],
                    )
                  }
                  className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700"
                >
                  Export CSV
                </button>
              </div>
            )}
            {loading && customers.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
                Loading customers…
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
                No customers match the current search.
              </div>
            ) : (
              filteredCustomers.map((c) => {
                const isSelected = selectedCustomer?.id === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCustomer(c)}
                    className={`bg-white rounded-lg shadow p-5 border cursor-pointer transition lift fade-in-up ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {c.name || 'Unnamed'}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {shortId(c.id)} · joined {fmtDate(c.created_at)}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {c.is_active ? 'active' : 'inactive'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                      <div>
                        <p className="text-xs text-gray-500">Mobile</p>
                        <p className="text-gray-700">{c.mobile || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Email</p>
                        <p className="text-gray-700 truncate">{c.email || '—'}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div>
            {!selectedCustomer ? (
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-sm text-gray-500">
                Select a customer to see their contact info and booking history.
              </div>
            ) : (
              <CustomerDetailPanel
                customer={selectedCustomer}
                canManage={userRole === 'super_admin'}
                onCustomerMutated={(next) => {
                  setCustomers((prev) =>
                    prev.map((c) => (c.id === next.id ? { ...c, ...next } : c)),
                  );
                  setSelectedCustomer((prev) =>
                    prev && prev.id === next.id ? { ...prev, ...next } : prev,
                  );
                }}
              />
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateTicketModal
          customers={customers}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          busy={actionBusy}
        />
      )}
    </div>
  );
}
