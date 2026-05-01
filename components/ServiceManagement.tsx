'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { servicesAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';

// Shape: see flipon-backend Service model. user_cost is for fixed-price
// consumer services; indicative_price_from/to describe quote-based industrial
// services (pricing_model === 'quote').

const money = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '—';
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');

type ServiceTypeKind = 'consumer' | 'industrial' | 'both';
type PricingModel = 'fixed' | 'quote';

interface RequiredDoc {
  type?: string;
  label?: string;
  required?: boolean;
}

interface ServiceRecord {
  id: string;
  name: string;
  category?: string;
  service_type?: ServiceTypeKind | string;
  pricing_model?: PricingModel | string;
  user_cost?: number | null;
  indicative_price_from?: number | null;
  indicative_price_to?: number | null;
  pricing_unit?: string;
  expected_timeline?: string;
  description?: string;
  is_active?: boolean;
  allow_pay_after?: boolean;
  required_documents?: Array<string | RequiredDoc>;
  created_at?: string;
  updated_at?: string;
}

const priceLabel = (s: ServiceRecord): string => {
  if (s.pricing_model === 'quote') {
    if (s.indicative_price_from && s.indicative_price_to) {
      return `${money(s.indicative_price_from)}–${money(s.indicative_price_to)}`;
    }
    if (s.indicative_price_from) return `from ${money(s.indicative_price_from)}`;
    return 'on quote';
  }
  return money(s.user_cost);
};

interface ServiceEditPatch {
  expected_timeline: string | null;
  description: string | null;
  is_active: boolean;
  user_cost?: number | null;
  indicative_price_from?: number | null;
  indicative_price_to?: number | null;
}

interface ServiceEditorProps {
  service: ServiceRecord;
  onSave: (patch: ServiceEditPatch) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}

interface EditorFormState {
  user_cost: number | string;
  indicative_price_from: number | string;
  indicative_price_to: number | string;
  expected_timeline: string;
  description: string;
  is_active: boolean;
}

function ServiceEditor({ service, onSave, onCancel, busy }: ServiceEditorProps) {
  const [form, setForm] = useState<EditorFormState>({
    user_cost: service.user_cost ?? '',
    indicative_price_from: service.indicative_price_from ?? '',
    indicative_price_to: service.indicative_price_to ?? '',
    expected_timeline: service.expected_timeline ?? '',
    description: service.description ?? '',
    is_active: !!service.is_active,
  });

  const isQuote = service.pricing_model === 'quote';
  const update = <K extends keyof EditorFormState>(k: K, v: EditorFormState[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const patch: ServiceEditPatch = {
      expected_timeline: form.expected_timeline || null,
      description: form.description || null,
      is_active: !!form.is_active,
    };
    if (isQuote) {
      patch.indicative_price_from =
        form.indicative_price_from === '' ? null : Number(form.indicative_price_from);
      patch.indicative_price_to =
        form.indicative_price_to === '' ? null : Number(form.indicative_price_to);
    } else {
      patch.user_cost = form.user_cost === '' ? null : Number(form.user_cost);
    }
    await onSave(patch);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {isQuote ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-gray-700 mb-1">Indicative ₹ from</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.indicative_price_from}
              onChange={(e) => update('indicative_price_from', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-700 mb-1">Indicative ₹ to</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.indicative_price_to}
              onChange={(e) => update('indicative_price_to', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
      ) : (
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Customer price ₹ (user_cost)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.user_cost}
            onChange={(e) => update('user_cost', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
      )}
      <label className="text-sm block">
        <span className="block text-gray-700 mb-1">Expected timeline</span>
        <input
          type="text"
          value={form.expected_timeline}
          onChange={(e) => update('expected_timeline', e.target.value)}
          placeholder="e.g. 3–5 business days"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <label className="text-sm block">
        <span className="block text-gray-700 mb-1">Description</span>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
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
        <span className="text-gray-700">Active (shown to customers)</span>
      </label>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 px-3 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface CreateServicePayload {
  name: string;
  category: string;
  service_type: ServiceTypeKind;
  pricing_model: PricingModel;
  expected_timeline: string | null;
  description: string | null;
  allow_pay_after: boolean;
  user_cost?: number;
  indicative_price_from?: number | null;
  indicative_price_to?: number | null;
}

interface NewServiceModalProps {
  onClose: () => void;
  onCreate: (payload: CreateServicePayload) => Promise<void>;
  busy: boolean;
}

interface NewFormState {
  name: string;
  category: string;
  service_type: ServiceTypeKind;
  pricing_model: PricingModel;
  user_cost: string;
  indicative_price_from: string;
  indicative_price_to: string;
  expected_timeline: string;
  description: string;
  allow_pay_after: boolean;
}

function NewServiceModal({ onClose, onCreate, busy }: NewServiceModalProps) {
  const [form, setForm] = useState<NewFormState>({
    name: '',
    category: '',
    service_type: 'consumer',
    pricing_model: 'fixed',
    user_cost: '',
    indicative_price_from: '',
    indicative_price_to: '',
    expected_timeline: '',
    description: '',
    allow_pay_after: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const update = <K extends keyof NewFormState>(k: K, v: NewFormState[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim() || !form.category.trim()) {
      setErr('Name and category are required.');
      return;
    }
    const isQuote = form.pricing_model === 'quote';
    const payload: CreateServicePayload = {
      name: form.name.trim(),
      category: form.category.trim(),
      service_type: form.service_type,
      pricing_model: form.pricing_model,
      expected_timeline: form.expected_timeline || null,
      description: form.description || null,
      allow_pay_after: form.allow_pay_after,
    };
    if (isQuote) {
      payload.indicative_price_from =
        form.indicative_price_from === '' ? null : Number(form.indicative_price_from);
      payload.indicative_price_to =
        form.indicative_price_to === '' ? null : Number(form.indicative_price_to);
    } else {
      if (!form.user_cost) {
        setErr('Customer price is required for fixed-price services.');
        return;
      }
      payload.user_cost = Number(form.user_cost);
    }
    try {
      await onCreate(payload);
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
        <h3 className="text-lg font-semibold text-gray-900">Add new service</h3>
        {err && (
          <div className="p-2 text-sm rounded bg-red-50 border border-red-200 text-red-800">
            {err}
          </div>
        )}
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Name</span>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Category</span>
            <input
              type="text"
              required
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
              placeholder="e.g. Aadhaar Services"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Type</span>
            <select
              value={form.service_type}
              onChange={(e) => update('service_type', e.target.value as ServiceTypeKind)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="consumer">Consumer (B2C)</option>
              <option value="industrial">Industrial (B2B)</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Pricing model</span>
          <select
            value={form.pricing_model}
            onChange={(e) => update('pricing_model', e.target.value as PricingModel)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="fixed">Fixed customer price</option>
            <option value="quote">Quote / indicative range</option>
          </select>
        </label>
        {form.pricing_model === 'quote' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm block">
              <span className="block text-gray-700 mb-1">Indicative ₹ from</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.indicative_price_from}
                onChange={(e) => update('indicative_price_from', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="text-sm block">
              <span className="block text-gray-700 mb-1">Indicative ₹ to</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.indicative_price_to}
                onChange={(e) => update('indicative_price_to', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
        ) : (
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Customer price ₹</span>
            <input
              type="number"
              required
              step="0.01"
              min="0"
              value={form.user_cost}
              onChange={(e) => update('user_cost', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
        )}
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Expected timeline</span>
          <input
            type="text"
            value={form.expected_timeline}
            onChange={(e) => update('expected_timeline', e.target.value)}
            placeholder="e.g. 3–5 business days"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-sm flex items-center space-x-2">
          <input
            type="checkbox"
            checked={form.allow_pay_after}
            onChange={(e) => update('allow_pay_after', e.target.checked)}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <span className="text-gray-700">Allow pay-after-service</span>
        </label>
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create service'}
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

export interface ServiceManagementProps {
  userRole?: string;
}

export default function ServiceManagement({ userRole = 'super_admin' }: ServiceManagementProps) {
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [selected, setSelected] = useState<ServiceRecord | null>(null);
  const [filterType, setFilterType] = useState<'all' | ServiceTypeKind>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [showNew, setShowNew] = useState<boolean>(false);

  // Per PDF: only super_admin modifies the service catalogue / pricing.
  const canEdit = can(userRole, CAP.SERVICE_EDIT);
  const canDelete = can(userRole, CAP.SERVICE_DELETE);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await servicesAPI.getAll();
        setServices(Array.isArray(data) ? (data as ServiceRecord[]) : []);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo<ServiceRecord[]>(() => {
    const q = searchTerm.trim().toLowerCase();
    return services.filter((s) => {
      if (filterType !== 'all' && s.service_type !== filterType) return false;
      if (filterStatus === 'active' && !s.is_active) return false;
      if (filterStatus === 'inactive' && s.is_active) return false;
      if (!q) return true;
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
      );
    });
  }, [services, filterType, filterStatus, searchTerm]);

  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    services.forEach((s) => s.category && set.add(s.category));
    return Array.from(set).sort();
  }, [services]);

  const replaceInList = (updated: ServiceRecord): void =>
    setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

  const handleSaveEdit = async (patch: ServiceEditPatch): Promise<void> => {
    if (!selected) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const updated = await servicesAPI.update(
        selected.id,
        patch as unknown as Record<string, unknown>,
      );
      const row: ServiceRecord =
        updated && typeof updated === 'object' ? (updated as ServiceRecord) : { ...selected, ...patch };
      replaceInList(row);
      setSelected(row);
      setEditing(false);
      setActionMsg(`Updated ${row.name}`);
    } catch (e: any) {
      setActionMsg(`Update failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleActive = async (service: ServiceRecord): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const updated = await servicesAPI.update(service.id, { is_active: !service.is_active });
      const row: ServiceRecord =
        updated && typeof updated === 'object'
          ? (updated as ServiceRecord)
          : { ...service, is_active: !service.is_active };
      replaceInList(row);
      if (selected?.id === service.id) setSelected(row);
      setActionMsg(`${row.name}: ${row.is_active ? 'activated' : 'deactivated'}`);
    } catch (e: any) {
      setActionMsg(`Toggle failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async (service: ServiceRecord): Promise<void> => {
    if (!confirm(`Delete service "${service.name}"? This cannot be undone.`)) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await servicesAPI.delete(service.id);
      setServices((prev) => prev.filter((s) => s.id !== service.id));
      if (selected?.id === service.id) setSelected(null);
      setActionMsg(`Deleted ${service.name}`);
    } catch (e: any) {
      setActionMsg(`Delete failed: ${e.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreate = async (payload: CreateServicePayload): Promise<void> => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const created = await servicesAPI.create(payload as unknown as Record<string, unknown>);
      if (created && typeof created === 'object')
        setServices((prev) => [created as ServiceRecord, ...prev]);
      setShowNew(false);
      setActionMsg(`Created ${payload.name}`);
    } catch (e: any) {
      setActionMsg(`Create failed: ${e.message}`);
      throw e;
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Service Management</h2>
          <p className="text-xs text-gray-500">
            Live catalog · {services.length} services ·{' '}
            {services.filter((s) => s.is_active).length} active · {categories.length} categories
            {!canEdit && ' · read-only for your role (Super Admin edits pricing & catalogue)'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + Add service
            </button>
          )}
          <div className="relative">
            <input
              type="text"
              placeholder="Search name / category"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | ServiceTypeKind)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All types</option>
            <option value="consumer">Consumer (B2C)</option>
            <option value="industrial">Industrial (B2B)</option>
            <option value="both">Both</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          Failed to load services: {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {loading && services.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
              Loading catalog…
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
              No services match the current filters.
            </div>
          ) : (
            filtered.map((s) => {
              const isSelected = selected?.id === s.id;
              return (
                <div
                  key={s.id}
                  className={`bg-white rounded-lg shadow p-5 border transition lift fade-in-up ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:shadow-md'
                  }`}
                >
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-gray-900">{s.name}</h3>
                      <p className="text-xs text-gray-500">
                        {shortId(s.id)} · updated {fmtDate(s.updated_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {s.is_active ? 'active' : 'inactive'}
                      </span>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
                        {s.service_type || 'consumer'}
                      </span>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-xs rounded-full">
                        {s.pricing_model || 'fixed'}
                      </span>
                    </div>
                  </div>

                  {s.description && (
                    <p className="text-sm text-gray-600 mb-3 line-clamp-3">{s.description}</p>
                  )}

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">Price</p>
                      <p className="text-lg font-semibold text-emerald-700">{priceLabel(s)}</p>
                      {s.pricing_unit && (
                        <p className="text-xs text-gray-500">per {s.pricing_unit.replace('_', ' ')}</p>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Category</p>
                      <p className="text-sm text-gray-600">{s.category || '—'}</p>
                      {s.expected_timeline && (
                        <p className="text-xs text-gray-500">⏱ {s.expected_timeline}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        setSelected(s);
                        setEditing(false);
                      }}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                    >
                      View details
                    </button>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => {
                            setSelected(s);
                            setEditing(true);
                          }}
                          className="px-3 py-1 border border-gray-300 text-sm rounded hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          disabled={actionBusy}
                          onClick={() => handleToggleActive(s)}
                          className={`px-3 py-1 text-sm rounded disabled:opacity-50 ${
                            s.is_active
                              ? 'border border-red-300 text-red-600 hover:bg-red-50'
                              : 'border border-green-300 text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {s.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-6">
          {!selected ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-sm text-gray-500">
              Select a service to see full details or edit it.
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {editing ? 'Edit service' : 'Service details'}
                  </h3>
                  {canEdit && !editing && (
                    <button
                      onClick={() => setEditing(true)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editing ? (
                  <ServiceEditor
                    key={selected.id}
                    service={selected}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditing(false)}
                    busy={actionBusy}
                  />
                ) : (
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">Name</p>
                      <p className="text-gray-600">{selected.name}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">ID</p>
                      <p className="text-gray-600 font-mono text-xs break-all">{selected.id}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Category</p>
                      <p className="text-gray-600">{selected.category || '—'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="font-medium text-gray-900">Type</p>
                        <p className="text-gray-600 capitalize">{selected.service_type || 'consumer'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Pricing model</p>
                        <p className="text-gray-600 capitalize">{selected.pricing_model || 'fixed'}</p>
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Price</p>
                      <p className="text-emerald-700 font-semibold">{priceLabel(selected)}</p>
                      {selected.pricing_unit && (
                        <p className="text-xs text-gray-500">
                          per {selected.pricing_unit.replace('_', ' ')}
                        </p>
                      )}
                    </div>
                    {selected.expected_timeline && (
                      <div>
                        <p className="font-medium text-gray-900">Timeline</p>
                        <p className="text-gray-600">{selected.expected_timeline}</p>
                      </div>
                    )}
                    {selected.description && (
                      <div>
                        <p className="font-medium text-gray-900">Description</p>
                        <p className="text-gray-600 whitespace-pre-wrap">{selected.description}</p>
                      </div>
                    )}
                    {Array.isArray(selected.required_documents) &&
                      selected.required_documents.length > 0 && (
                        <div>
                          <p className="font-medium text-gray-900">Required documents</p>
                          <ul className="mt-1 space-y-1">
                            {selected.required_documents.map((d, i) => (
                              <li key={i} className="text-xs text-gray-600">
                                · {typeof d === 'string' ? d : d.label || d.type}
                                {typeof d === 'object' && d.required ? ' (required)' : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="font-medium text-gray-900">Created</p>
                        <p className="text-gray-600">{fmtDate(selected.created_at)}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Updated</p>
                        <p className="text-gray-600">{fmtDate(selected.updated_at)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {canDelete && (
                <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Danger zone</h3>
                  <button
                    disabled={actionBusy}
                    onClick={() => handleDelete(selected)}
                    className="w-full px-3 py-2 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete service
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    Deletes the service from the catalog. Bookings already placed against it are
                    unaffected.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNew && (
        <NewServiceModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
          busy={actionBusy}
        />
      )}
    </div>
  );
}
