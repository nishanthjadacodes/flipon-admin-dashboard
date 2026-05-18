'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { flashNotificationsAPI, type FlashNotification } from '@/utils/api';

// Super admin–only "Flash Notifications" surface. Edits banners that
// the customer app shows on launch (Flipkart / Myntra festive-offer
// pattern). Each row supports an image, body copy, an optional CTA,
// an active window (from / until), and an audience filter so admin
// can target only guests, only logged-in users, or everyone.

const TONE_ACTIVE = 'bg-green-100 text-green-800 border border-green-200';
const TONE_INACTIVE = 'bg-gray-100 text-gray-700 border border-gray-200';

interface FlashNotificationsProps {
  userRole?: string;
}

const emptyForm = (): Partial<FlashNotification> => ({
  title: '',
  body: '',
  image_url: '',
  cta_label: '',
  cta_url: '',
  audience: 'all',
  priority: 0,
  is_active: true,
  active_from: '',
  active_until: '',
  discount_percent: null,
  target_service_pattern: '',
});

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

// Trim a yyyy-mm-ddThh:mm string out of an ISO timestamp so the
// <input type="datetime-local"> renders with the existing value.
const toLocalInput = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function FlashNotifications({ userRole }: FlashNotificationsProps) {
  const [rows, setRows] = useState<FlashNotification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<FlashNotification> | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const canManage = userRole === 'super_admin';

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const resp: any = await flashNotificationsAPI.list();
      const data = Array.isArray(resp?.data) ? resp.data : Array.isArray(resp) ? resp : [];
      setRows(data as FlashNotification[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.is_active).length;
    return { total: rows.length, active };
  }, [rows]);

  if (!canManage) {
    return (
      <div className="p-6 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
        Flash Notifications can only be managed by a Super Admin role.
      </div>
    );
  }

  const handleSave = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editing) return;
    if (!editing.title || !String(editing.title).trim()) {
      alert('Title is required');
      return;
    }
    setSaving(true);
    try {
      // Convert datetime-local strings to ISO; empty → null so the
      // backend stores NULL instead of an invalid date.
      const discPctRaw = editing.discount_percent;
      const discPct =
        discPctRaw == null || discPctRaw === ('' as any)
          ? null
          : Math.max(0, Math.min(100, Number(discPctRaw)));
      const payload: Partial<FlashNotification> = {
        ...editing,
        title: String(editing.title).trim(),
        priority: Number(editing.priority || 0),
        active_from: editing.active_from ? new Date(editing.active_from).toISOString() : null,
        active_until: editing.active_until ? new Date(editing.active_until).toISOString() : null,
        discount_percent: Number.isFinite(discPct as number) && (discPct as number) > 0 ? discPct : null,
        target_service_pattern:
          editing.target_service_pattern && String(editing.target_service_pattern).trim()
            ? String(editing.target_service_pattern).trim()
            : null,
      };
      if (editing.id) {
        await flashNotificationsAPI.update(editing.id, payload);
      } else {
        await flashNotificationsAPI.create(payload);
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      alert(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row: FlashNotification): Promise<void> => {
    try {
      await flashNotificationsAPI.update(row.id, { is_active: !row.is_active });
      await load();
    } catch (e: any) {
      alert(e?.message || 'Toggle failed');
    }
  };

  const handleDelete = async (row: FlashNotification): Promise<void> => {
    if (!window.confirm(`Delete "${row.title}"? This can't be undone.`)) return;
    try {
      await flashNotificationsAPI.remove(row.id);
      await load();
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Flash Notifications</h2>
          <p className="text-sm text-gray-500">
            Splash banners shown in the customer app before login. Use for festive
            offers, important announcements, downtime warnings. Showing
            {' '}{counts.active} active of {counts.total} total.
          </p>
        </div>
        <button
          onClick={() => setEditing(emptyForm())}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm"
        >
          + New Notification
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : error ? (
        <p className="text-red-700 text-sm">Failed: {error}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          No flash notifications yet. Click <strong>+ New Notification</strong> to
          add your first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm flex gap-3"
            >
              {row.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.image_url}
                  alt={row.title}
                  className="w-20 h-20 object-cover rounded-md flex-shrink-0 border border-gray-200"
                />
              ) : (
                <div className="w-20 h-20 rounded-md bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">
                  📣
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 truncate">{row.title}</h3>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${
                      row.is_active ? TONE_ACTIVE : TONE_INACTIVE
                    }`}
                  >
                    {row.is_active ? 'Active' : 'Off'}
                  </span>
                </div>
                {row.body && (
                  <p className="text-xs text-gray-600 line-clamp-2 mt-1">{row.body}</p>
                )}
                <div className="mt-2 text-[11px] text-gray-500 space-y-0.5">
                  <p>
                    Audience: <span className="font-medium capitalize">{row.audience}</span>
                    {' · '}
                    Priority: <span className="font-medium">{row.priority}</span>
                  </p>
                  <p>From: {fmtDate(row.active_from)} · Until: {fmtDate(row.active_until)}</p>
                  {row.discount_percent != null && row.discount_percent > 0 && (
                    <p className="text-emerald-700 font-semibold">
                      💸 {row.discount_percent}% off
                      {row.target_service_pattern
                        ? ` · matches "${row.target_service_pattern}"`
                        : ' · no service filter (won\'t apply)'}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() =>
                      setEditing({
                        ...row,
                        active_from: toLocalInput(row.active_from),
                        active_until: toLocalInput(row.active_until),
                      })
                    }
                    className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 font-medium text-gray-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleActive(row)}
                    className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 font-medium text-gray-700"
                  >
                    {row.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(row)}
                    className="text-xs px-3 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-16 overflow-y-auto"
          onClick={() => !saving && setEditing(null)}
        >
          <form
            onSubmit={handleSave}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4 max-h-[88vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 p-5 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editing.id ? 'Edit notification' : 'New flash notification'}
              </h3>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                ✕ Close
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Title *">
                <input
                  required
                  maxLength={140}
                  value={editing.title || ''}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="🎉 Diwali Sale — 50% off all PAN services"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </Field>
              <Field label="Body">
                <textarea
                  rows={3}
                  value={editing.body || ''}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  placeholder="Book any PAN service this week and save 50%. Limited time offer."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </Field>
              <Field label="Image URL (Cloudinary / CDN)">
                <input
                  value={editing.image_url || ''}
                  onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                  placeholder="https://res.cloudinary.com/…/diwali-banner.jpg"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CTA label (optional)">
                  <input
                    value={editing.cta_label || ''}
                    onChange={(e) => setEditing({ ...editing, cta_label: e.target.value })}
                    placeholder="Shop now"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </Field>
                <Field label="CTA URL (optional)">
                  <input
                    value={editing.cta_url || ''}
                    onChange={(e) => setEditing({ ...editing, cta_url: e.target.value })}
                    placeholder="https://… or fliponex://services/pan"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Audience">
                  <select
                    value={editing.audience || 'all'}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        audience: e.target.value as FlashNotification['audience'],
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="all">All users</option>
                    <option value="guest">Guests only (pre-login)</option>
                    <option value="logged_in">Logged-in users only</option>
                  </select>
                </Field>
                <Field label="Priority (higher first)">
                  <input
                    type="number"
                    value={editing.priority ?? 0}
                    onChange={(e) =>
                      setEditing({ ...editing, priority: Number(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Active from (optional)">
                  <input
                    type="datetime-local"
                    value={(editing.active_from as string) || ''}
                    onChange={(e) => setEditing({ ...editing, active_from: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </Field>
                <Field label="Active until (optional)">
                  <input
                    type="datetime-local"
                    value={(editing.active_until as string) || ''}
                    onChange={(e) => setEditing({ ...editing, active_until: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </Field>
              </div>

              {/* Discount fields — when both filled, customer app
                  applies the % off in Payment Summary for any service
                  matching the target pattern. Leave both blank for a
                  display-only banner with no pricing effect. */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                  💸 Discount (optional)
                </p>
                <p className="text-[11px] text-emerald-900/80">
                  When both filled, customers see this discount applied in their
                  Payment Summary for any service whose name OR category
                  contains the keyword (case-insensitive). Leave blank for an
                  announcement-only banner.
                </p>
                {/* Force equal column widths + flex column so both
                    Fields' input rows line up even when one label
                    wraps onto two lines. Labels use the same height
                    via flex-shrink-0 + min-h so the inputs sit on
                    the same baseline. */}
                <div className="grid grid-cols-2 gap-3 items-start">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide min-h-[16px]">
                      Discount %
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={
                        editing.discount_percent == null
                          ? ''
                          : String(editing.discount_percent)
                      }
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          discount_percent:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      placeholder="e.g. 50"
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide min-h-[16px]">
                      Target keyword
                    </span>
                    <input
                      value={editing.target_service_pattern || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, target_service_pattern: e.target.value })
                      }
                      placeholder="aadhaar / pan / gst / voter…"
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!editing.is_active}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                />
                Active (show this notification in the customer app)
              </label>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : editing.id ? 'Save changes' : 'Create notification'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
