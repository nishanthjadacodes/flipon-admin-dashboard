'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { servicesAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';
import { useModalBackClose } from '@/utils/useModalBackClose';
import { shortCode } from '@/utils/shortCode';

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
  govt_fees?: number | null;
  partner_earning?: number | null;
  company_margin?: number | null;
  total_expense?: number | null;
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
  govt_fees?: number | null;
  partner_earning?: number | null;
  company_margin?: number | null;
  total_expense?: number | null;
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
  govt_fees: number | string;
  partner_earning: number | string;
  company_margin: number | string;
  indicative_price_from: number | string;
  indicative_price_to: number | string;
  expected_timeline: string;
  description: string;
  is_active: boolean;
}

function ServiceEditor({ service, onSave, onCancel, busy }: ServiceEditorProps) {
  const [form, setForm] = useState<EditorFormState>({
    user_cost: service.user_cost ?? '',
    govt_fees: service.govt_fees ?? '',
    partner_earning: service.partner_earning ?? '',
    company_margin: service.company_margin ?? '',
    indicative_price_from: service.indicative_price_from ?? '',
    indicative_price_to: service.indicative_price_to ?? '',
    expected_timeline: service.expected_timeline ?? '',
    description: service.description ?? '',
    is_active: !!service.is_active,
  });
  const [editErr, setEditErr] = useState<string | null>(null);

  const isQuote = service.pricing_model === 'quote';
  const update = <K extends keyof EditorFormState>(k: K, v: EditorFormState[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setEditErr(null);
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
      const userCost = form.user_cost === '' ? null : Number(form.user_cost);
      patch.user_cost = userCost;

      // If admin filled any split field, validate they all add up to
      // user_cost. Leaving all three blank is allowed — preserves the
      // legacy behaviour of just bumping user_cost without re-keying
      // the chart split.
      const splitTouched =
        form.govt_fees !== '' ||
        form.partner_earning !== '' ||
        form.company_margin !== '';
      if (splitTouched) {
        const govt = Number(form.govt_fees || 0);
        const partner = Number(form.partner_earning || 0);
        const margin = Number(form.company_margin || 0);
        if (form.govt_fees === '' || form.partner_earning === '' || form.company_margin === '') {
          setEditErr('When editing the split, fill all three fields (or leave all blank to keep existing).');
          return;
        }
        if (userCost == null) {
          setEditErr('Customer price is required when editing the split.');
          return;
        }
        const sum = govt + partner + margin;
        if (Math.round(sum) !== Math.round(userCost)) {
          setEditErr(
            `Split must add up to Customer Price (₹${userCost}). ` +
            `Currently: ₹${govt} + ₹${partner} + ₹${margin} = ₹${sum}.`,
          );
          return;
        }
        patch.govt_fees = govt;
        patch.partner_earning = partner;
        patch.company_margin = margin;
        patch.total_expense = govt + partner;
      }
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
        <>
          <label className="text-sm block">
            <span className="block text-gray-700 mb-1">Customer price ₹ (user_cost)</span>
            <input
              type="number"
              step="1"
              min="0"
              value={form.user_cost}
              onChange={(e) => update('user_cost', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {/* Rate-chart split — optional on edit (leave all blank to
              keep the existing values), but if any field is touched all
              three must be filled and must add up to user_cost. */}
          <div className="mt-1 p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-2">
            <p className="text-xs font-semibold text-gray-700">
              Rate-chart split (Govt + Service Partner + Company Margin = Customer Price)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs block">
                <span className="block text-gray-600 mb-1">Govt Fees ₹</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.govt_fees}
                  onChange={(e) => update('govt_fees', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-xs block">
                <span className="block text-gray-600 mb-1">Service Partner ₹</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.partner_earning}
                  onChange={(e) => update('partner_earning', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-xs block">
                <span className="block text-gray-600 mb-1">Company Margin ₹</span>
                <input
                  type="number"
                  step="1"
                  value={form.company_margin}
                  onChange={(e) => update('company_margin', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            {(() => {
              const userCost = Number(form.user_cost || 0);
              const govt = Number(form.govt_fees || 0);
              const partner = Number(form.partner_earning || 0);
              const margin = Number(form.company_margin || 0);
              const sum = govt + partner + margin;
              const empty =
                form.govt_fees === '' &&
                form.partner_earning === '' &&
                form.company_margin === '';
              if (empty) {
                return (
                  <p className="text-[11px] text-gray-500">
                    Leave blank to keep existing values, or fill all three to overwrite.
                  </p>
                );
              }
              const ok = userCost > 0 && Math.round(sum) === Math.round(userCost);
              return (
                <p
                  className={`text-[11px] font-semibold ${
                    ok ? 'text-green-700' : 'text-amber-700'
                  }`}
                >
                  Sum: ₹{sum} {ok ? '✓ matches Customer Price' : `↔ Customer Price ₹${userCost} (off by ₹${userCost - sum})`}
                </p>
              );
            })()}
          </div>
          {editErr && (
            <div className="p-2 text-xs rounded bg-red-50 border border-red-200 text-red-800">
              {editErr}
            </div>
          )}
        </>
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
  // Rate-chart split — required for fixed-price services so the
  // booking flow, rep commission, and admin reports all use the
  // same canonical numbers. Sum must equal user_cost.
  govt_fees?: number;
  partner_earning?: number;
  company_margin?: number;
  total_expense?: number;
  indicative_price_from?: number | null;
  indicative_price_to?: number | null;
}

interface NewServiceModalProps {
  onClose: () => void;
  onCreate: (payload: CreateServicePayload) => Promise<void>;
  busy: boolean;
  existingCategories: string[];
}

// Canonical category options shown in the Add Service dropdown. Includes
// the categories we ship out of the box even when no service is using
// them yet — without this, "Common Service Application" wasn't selectable
// because the dropdown was a free-text input and admins had to remember
// the exact spelling. The list merges with categories already present
// in the services table so custom categories stay visible.
const CANONICAL_CATEGORIES: string[] = [
  'Common Service Application',
  'Aadhaar Services',
  'PAN Services',
  'Voter ID Services',
  'Passport Services',
  'Driving Licence',
  'Ration Card',
  'Income Certificate',
  'Caste Certificate',
  'Domicile Certificate',
  'Birth Certificate',
  'Death Certificate',
  'Marriage Certificate',
  'GST / Business Registration',
  'Property & Land Records',
  'Banking & Finance',
  'Travel & Bookings',
  'Recharge & Utilities',
  'Compliance & Licensing',
  'Industrial / B2B',
];

interface NewFormState {
  name: string;
  category: string;
  service_type: ServiceTypeKind;
  pricing_model: PricingModel;
  user_cost: string;
  govt_fees: string;
  partner_earning: string;
  company_margin: string;
  indicative_price_from: string;
  indicative_price_to: string;
  expected_timeline: string;
  description: string;
  allow_pay_after: boolean;
}

function NewServiceModal({ onClose, onCreate, busy, existingCategories }: NewServiceModalProps) {
  // Merge canonical + existing, dedupe, alphabetize. "Other" sentinel
  // sits at the bottom so admins can fall back to a free-text value
  // when they really need to add a brand-new category.
  const categoryOptions = useMemo<string[]>(() => {
    const set = new Set<string>([...CANONICAL_CATEGORIES, ...existingCategories.filter(Boolean)]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [existingCategories]);
  const [customCategory, setCustomCategory] = useState<string>('');
  // Browser back closes the modal instead of leaving the services page.
  useModalBackClose(true, onClose);
  const [form, setForm] = useState<NewFormState>({
    name: '',
    category: '',
    service_type: 'consumer',
    pricing_model: 'fixed',
    user_cost: '',
    govt_fees: '',
    partner_earning: '',
    company_margin: '',
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
      const userCost = Number(form.user_cost);
      const govt = Number(form.govt_fees || 0);
      const partner = Number(form.partner_earning || 0);
      const margin = Number(form.company_margin || 0);

      // Require admin to specify the rate-chart split so the rep
      // commission + company share are deterministic for every booking
      // of this service. Sum must match user_cost exactly — a rupee
      // off and the booking screen's bill summary will look wrong.
      if (form.govt_fees === '' || form.partner_earning === '' || form.company_margin === '') {
        setErr('Govt Fees, Service Partner Earning, and Company Margin are required for fixed-price services.');
        return;
      }
      const splitSum = govt + partner + margin;
      if (Math.round(splitSum) !== Math.round(userCost)) {
        setErr(
          `Split must add up to Customer Price (₹${userCost}). ` +
          `Currently: ₹${govt} + ₹${partner} + ₹${margin} = ₹${splitSum}.`,
        );
        return;
      }

      payload.user_cost = userCost;
      payload.govt_fees = govt;
      payload.partner_earning = partner;
      payload.company_margin = margin;
      payload.total_expense = govt + partner; // FliponeX's outflow
    }
    try {
      await onCreate(payload);
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
            <select
              required
              value={
                form.category && categoryOptions.includes(form.category)
                  ? form.category
                  : form.category
                    ? '__other'
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__other') {
                  // Keep whatever custom text is already typed (or empty)
                  // so the input below shows up for the admin to fill in.
                  update('category', customCategory);
                } else {
                  setCustomCategory('');
                  update('category', v);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select a category…</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__other">Other (type custom)…</option>
            </select>
            {form.category !== '' && !categoryOptions.includes(form.category) && (
              <input
                type="text"
                required
                value={customCategory}
                onChange={(e) => {
                  setCustomCategory(e.target.value);
                  update('category', e.target.value);
                }}
                placeholder="Enter custom category"
                className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            )}
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
          <>
            <label className="text-sm block">
              <span className="block text-gray-700 mb-1">Customer price ₹ (user_cost)</span>
              <input
                type="number"
                required
                step="1"
                min="0"
                value={form.user_cost}
                onChange={(e) => update('user_cost', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
            {/* Rate-chart split — required so the booking flow, rep
                commission, and reports all derive from the same numbers
                instead of best-guessing from user_cost alone. */}
            <div className="mt-1 p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-2">
              <p className="text-xs font-semibold text-gray-700">
                Rate-chart split (Govt Fees + Service Partner + Company Margin = Customer Price)
              </p>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs block">
                  <span className="block text-gray-600 mb-1">Govt Fees ₹</span>
                  <input
                    type="number"
                    required
                    step="1"
                    min="0"
                    value={form.govt_fees}
                    onChange={(e) => update('govt_fees', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="text-xs block">
                  <span className="block text-gray-600 mb-1">Service Partner ₹</span>
                  <input
                    type="number"
                    required
                    step="1"
                    min="0"
                    value={form.partner_earning}
                    onChange={(e) => update('partner_earning', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="text-xs block">
                  <span className="block text-gray-600 mb-1">Company Margin ₹</span>
                  <input
                    type="number"
                    required
                    step="1"
                    value={form.company_margin}
                    onChange={(e) => update('company_margin', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>
              {(() => {
                // Live preview — green when split matches, amber when off.
                const userCost = Number(form.user_cost || 0);
                const govt = Number(form.govt_fees || 0);
                const partner = Number(form.partner_earning || 0);
                const margin = Number(form.company_margin || 0);
                const sum = govt + partner + margin;
                const ok = userCost > 0 && Math.round(sum) === Math.round(userCost);
                const empty =
                  !form.govt_fees && !form.partner_earning && !form.company_margin;
                if (empty) {
                  return (
                    <p className="text-[11px] text-gray-500">
                      Example for Aadhaar Address Update (₹275): Govt 75 + Partner 100 + Margin 100.
                    </p>
                  );
                }
                return (
                  <p
                    className={`text-[11px] font-semibold ${
                      ok ? 'text-green-700' : 'text-amber-700'
                    }`}
                  >
                    Sum: ₹{sum} {ok ? '✓ matches Customer Price' : `↔ Customer Price ₹${userCost} (off by ₹${userCost - sum})`}
                  </p>
                );
              })()}
            </div>
          </>
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

      {/* List takes the full row now. Details + Edit moved into a
          viewport-centered modal so the admin doesn't have to scroll
          past the rest of the catalog to view or edit a service. */}
      <div className="space-y-4">
        <div className="space-y-4">
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

        {/* Details / Edit modal — opens centered in the viewport when a
            service row's "View details" or "Edit" button is tapped.
            Previously this was a right-column panel in a 3-col grid,
            which on narrow screens (and on long lists) pushed the
            details below the fold so the admin had to scroll to see
            anything. Centered modal removes that friction. */}
        {selected && (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 pt-20 sm:pt-4 overflow-y-auto"
            onClick={() => {
              setSelected(null);
              setEditing(false);
            }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 max-h-[88vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4 sticky top-0 bg-white pt-1 pb-3 border-b border-gray-100 -mx-6 px-6">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {editing ? 'Edit service' : 'Service details'}
                  </h3>
                  <div className="flex items-center gap-2">
                    {canEdit && !editing && (
                      <button
                        onClick={() => setEditing(true)}
                        className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setSelected(null);
                        setEditing(false);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 shadow-sm flex items-center gap-1.5"
                      aria-label="Close"
                    >
                      <span className="text-sm leading-none">✕</span>
                      <span>Close</span>
                    </button>
                  </div>
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
                      <p className="font-medium text-gray-900">Service ID</p>
                      <p className="text-gray-900 font-mono text-sm font-semibold">
                        {shortCode('FLIPSER', selected.id, 3)}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Category</p>
                      <p className="text-gray-600">{selected.category || '—'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="font-medium text-gray-900">Type</p>
                        {/* "both" used to fall through to capitalize "Both"
                            which confused operators — every service is
                            really either consumer-facing (Common) or
                            business-facing (Industrial). Map "both" →
                            "Common" so it never reads as ambiguous. */}
                        <p className="text-gray-600">
                          {(() => {
                            const t = String(selected.service_type || 'consumer').toLowerCase();
                            if (t === 'industrial' || t === 'b2b') return 'Industrial';
                            return 'Common';
                          })()}
                        </p>
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
                    {/* Documents required at booking time — shown
                        prominently so the operator knows exactly what
                        the customer has to upload before a rep can be
                        dispatched. Each row spells out the doc name,
                        not just the machine type id. */}
                    {Array.isArray(selected.required_documents) &&
                      selected.required_documents.length > 0 && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <p className="font-medium text-gray-900 mb-2">
                            Documents required at booking
                          </p>
                          <ul className="space-y-1.5">
                            {selected.required_documents.map((d, i) => {
                              const rawLabel =
                                typeof d === 'string' ? d : d.label || d.type || `Document ${i + 1}`;
                              // Match the customer-app rewrite: bare
                              // "Email ID" / "Mobile Number" labels read
                              // like the user must upload the value
                              // itself, so they're shown as " Proof".
                              const label = /^email\s*id$/i.test(rawLabel)
                                ? 'Email ID Proof'
                                : /^mobile\s*(no\.?|number)?$/i.test(rawLabel)
                                  ? 'Mobile Number Proof'
                                  : rawLabel;
                              const isOptional =
                                typeof d === 'object' && d.required === false;
                              return (
                                <li
                                  key={i}
                                  className="text-sm text-gray-800 flex items-start gap-2"
                                >
                                  <span className="text-blue-600 font-bold">
                                    {i + 1}.
                                  </span>
                                  <span>
                                    {label}
                                    {isOptional ? (
                                      <span className="text-xs text-gray-500 ml-1">
                                        (optional)
                                      </span>
                                    ) : (
                                      <span className="text-xs text-red-600 ml-1">*</span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
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

                {canDelete && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-red-600 mb-2">Danger zone</h4>
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
              </div>
            </div>
          </div>
        )}
      </div>

      {showNew && (
        <NewServiceModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
          busy={actionBusy}
          existingCategories={categories}
        />
      )}
    </div>
  );
}
