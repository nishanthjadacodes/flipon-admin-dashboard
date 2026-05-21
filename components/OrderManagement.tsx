'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ordersAPI, agentsAPI, documentsAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';
import { downloadCsv } from '@/utils/csv';
import { useModalBackClose } from '@/utils/useModalBackClose';

// Backend status values come from the Booking model.
type OrderStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'documents_collected'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

interface StatusEntry {
  key: OrderStatus;
  label: string;
}

const STATUS_ORDER: StatusEntry[] = [
  { key: 'pending', label: 'Order Received' },
  { key: 'assigned', label: 'Representative Assigned' },
  { key: 'accepted', label: 'Representative Accepted' },
  { key: 'documents_collected', label: 'Documents Collected' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
];

const statusTone: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  accepted: 'bg-blue-100 text-blue-800',
  documents_collected: 'bg-purple-100 text-purple-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

interface CustomerLite {
  name?: string;
  mobile?: string;
  email?: string;
}

interface AgentLite {
  id: string;
  name?: string;
  mobile?: string;
  rating?: number;
  online_status?: boolean;
  total_jobs_completed?: number;
  is_kyc_verified?: boolean;
}

interface OrderRecord {
  id: string;
  ref?: string;
  // Customer-facing sequential code from the backend (starts at 1000).
  // Used by refOf() to render short display IDs like "FLP-1000".
  booking_number?: number | string | null;
  status?: OrderStatus | string;
  booking_type?: 'consumer' | 'industrial' | string;
  created_at?: string;
  customer?: CustomerLite;
  customer_name?: string;
  // Person the service is FOR (e.g. a family member). NULL when the
  // booking customer is also the applicant — fall back to customer name.
  applicant_name?: string;
  customer_mobile?: string;
  service?: { name?: string };
  agent?: AgentLite;
  final_price?: number;
  price_quoted?: number;
  payment_status?: string;
  payment_method?: string;
  transaction_id?: string;
  amount_paid?: number;
  paid_at?: string;
  preferred_date?: string;
  preferred_time?: string;
  address?: string;
  notes?: string;
  cancellation_reason?: string;
  cancelled_at?: string;
}

interface DocumentRecord {
  id: string;
  document_type?: string;
  file_name?: string;
  file_url?: string;
  mime_type?: string;
  is_verified?: boolean;
  notes?: string;
}

const isImageDoc = (d: DocumentRecord): boolean => {
  if (d.mime_type && d.mime_type.startsWith('image/')) return true;
  const url = d.file_url || d.file_name || '';
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif)(\?|$)/i.test(url);
};

// Inline thumbnail with onError fallback. If the image 404s (file gone
// from Render's disk) we swap to a 📄 tile so the row doesn't show a
// broken-image icon. Click opens the full preview modal regardless.
function DocThumbnail({
  doc,
  onClick,
}: {
  doc: DocumentRecord;
  onClick: () => void;
}) {
  const [failed, setFailed] = useState<boolean>(false);
  if (failed || !doc.file_url) {
    return (
      <button
        onClick={onClick}
        className="w-20 h-20 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-3xl hover:bg-gray-100"
        title="Image unavailable — click for details"
      >
        📄
      </button>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={doc.file_url}
      alt={doc.document_type || 'document'}
      onClick={onClick}
      onError={() => setFailed(true)}
      className="w-20 h-20 rounded object-cover border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity bg-gray-50"
    />
  );
}

// Full-screen modal for previewing a doc image. Tracks loading/error state
// so the user gets a spinner while loading and a useful message (with the
// failing URL + Open-in-new-tab fallback) instead of a black void when the
// image 404s — which is what was happening when Render's ephemeral disk
// wiped older uploads.
// Normalise the doc's URL so the preview always loads against the API
// origin. Relative paths (`/uploads/...`) and localhost URLs would fail
// when the admin dashboard runs on a different origin (the production
// Vercel deploy can't reach `localhost:3001`). Cloudinary / absolute
// http(s) URLs pass through unchanged.
const fixDocUrlAdmin = (raw?: string): string => {
  if (!raw) return '';
  const url = String(raw).trim();
  // Already absolute — but rewrite localhost so the admin dashboard
  // hosted on Vercel can still load assets from the deployed backend.
  if (/^https?:\/\//i.test(url)) {
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      return apiBase ? `${apiBase}${path}` : url;
    }
    return url;
  }
  // Relative path — prefix with the API origin.
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
  if (!apiBase) return url;
  return url.startsWith('/') ? `${apiBase}${url}` : `${apiBase}/${url}`;
};

const isPdfDoc = (doc: DocumentRecord, url: string): boolean => {
  if (doc.mime_type === 'application/pdf') return true;
  return /\.pdf(\?|$)/i.test(url);
};

function DocPreviewOverlay({
  doc,
  onClose,
}: {
  doc: DocumentRecord;
  onClose: () => void;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const url = fixDocUrlAdmin(doc.file_url);
  const renderAsPdf = isPdfDoc(doc, url);
  const renderAsImage = !!url && !renderAsPdf;

  // Reset state whenever the previewed doc changes (admin clicks a different
  // thumbnail without closing the modal first).
  useEffect(() => {
    setState('loading');
  }, [url]);

  // SSR safety — only access document on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while the modal is open so the page underneath
  // doesn't scroll when the user wheel-scrolls inside an open modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  // ─── Portal-rendered overlay ─────────────────────────────────────────
  // Renders directly under <body> so the `fixed inset-0` positioning is
  // relative to the viewport, NOT to whatever ancestor in the parent
  // React tree happens to have a `transform` / `filter` / `perspective`
  // CSS property (those create new containing blocks for fixed-position
  // descendants — the symptom: the modal anchored at the top of the
  // ScrollView's container and the user had to scroll up to see it).
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        // Compact centred modal — was max-w-5xl (huge) before. Now tops
        // out at ~440px wide with a comfortably constrained image area
        // so the preview reads as "popover next to the document I just
        // clicked" rather than a full-page overlay.
        className="relative w-full max-w-md max-h-[88vh] bg-white rounded-xl overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {(doc.document_type || 'document').replace(/_/g, ' ')}
            {doc.file_name ? ` · ${doc.file_name}` : ''}
          </p>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Open in new tab
            </a>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-900 text-xl leading-none px-2"
              aria-label="Close preview"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="relative bg-gray-50 flex items-center justify-center min-h-[260px] max-h-[70vh]">
          {/* PDF path — iframe with the same compact dimensions as the
              image path so the modal stays a popover, not a full-screen
              viewer (admin can still tap "Open in new tab" if they want
              the full PDF reader). */}
          {renderAsPdf && url && (
            <iframe
              src={url}
              title={doc.file_name || 'PDF preview'}
              onLoad={() => setState('loaded')}
              onError={() => setState('error')}
              className="w-full h-[60vh] bg-white"
            />
          )}

          {/* Image path — capped to the modal's height so the picture
              never blows out the viewport. */}
          {renderAsImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt="Document preview"
              onLoad={() => setState('loaded')}
              onError={() => setState('error')}
              className={`max-w-full max-h-[60vh] object-contain ${
                state === 'loaded' ? '' : 'invisible absolute'
              }`}
            />
          )}

          {state === 'loading' && (
            <div className="flex flex-col items-center text-gray-600">
              <svg className="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
                <path
                  d="M4 12a8 8 0 018-8"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
              <p className="text-sm mt-3">{renderAsPdf ? 'Loading PDF…' : 'Loading image…'}</p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center text-center px-6 py-10 text-gray-700">
              <span className="text-4xl">⚠️</span>
              <p className="mt-3 font-semibold text-gray-900">
                Could not load {renderAsPdf ? 'PDF' : 'image'}
              </p>
              <p className="mt-1 text-sm text-gray-600 max-w-md">
                The file may have been removed from storage. New uploads will persist
                once Cloudinary is configured on the backend.
              </p>
              <p className="mt-3 text-[11px] text-gray-400 break-all max-w-md">{url || '(empty URL)'}</p>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Open in new tab
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Customer-facing booking ID. This MUST render identically to the
// customer app — same "Flip#1004" the customer sees in My Bookings,
// so support staff and customers are always talking about the same
// reference. Mirrors src/utils/bookingId.ts → formatBookingId in
// customerandroidapp 1:1. If you change the format there, change it
// here too.
//
//   • Numeric booking_number → "Flip#" + 4-digit zero-padded.
//     Numbers below 1000 are bumped by +1000 (legacy bookings
//     created before the 1000-floor shipped) so 73 → Flip#1073.
//   • No digits (raw UUID) → "Flip#" + first 4 alphanumerics, upper.
const BOOKING_DISPLAY_FLOOR = 1000;
const formatBookingId = (input: number | string | null | undefined): string => {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  const digitMatch = raw.match(/(\d+)/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (!Number.isNaN(n)) {
      const displayN = n < BOOKING_DISPLAY_FLOOR ? n + BOOKING_DISPLAY_FLOOR : n;
      return `Flip#${String(displayN).padStart(4, '0')}`;
    }
  }
  const fallback = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return fallback ? `Flip#${fallback}` : '';
};

// Resolves the booking's display ID. Uses booking_number (the same
// field the customer app formats from) and falls back to the UUID —
// always rendered through formatBookingId so it matches the app.
const refOf = (o: OrderRecord): string => {
  const seed =
    o.booking_number != null && o.booking_number !== ''
      ? o.booking_number
      : o.id;
  return formatBookingId(seed) || 'Flip#—';
};
const money = (n: unknown): string => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function StagePipeline({ status }: { status?: string }) {
  const currentIdx = STATUS_ORDER.findIndex((s) => s.key === status);
  return (
    <ol className="space-y-2">
      {STATUS_ORDER.map((s, idx) => {
        const done = idx <= currentIdx;
        return (
          <li key={s.key} className="flex items-center space-x-3">
            <span
              className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-[10px] font-bold
                ${done ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500'}`}
            >
              {idx + 1}
            </span>
            <span className={`text-sm ${done ? 'text-gray-900' : 'text-gray-500'}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DocumentsReview({ bookingId, canVerify }: { bookingId: string; canVerify: boolean }) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentRecord | null>(null);
  // Rejection-reason modal — replaces the browser-style window.prompt()
  // which renders that ugly "The page at admindashboard.vercel.app
  // says…" header that doesn't match the rest of the dashboard's UI.
  const [rejectingDoc, setRejectingDoc] = useState<DocumentRecord | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejectSubmitting, setRejectSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Browser back closes the modal instead of leaving the page. Pushes
  // a synthetic history entry while open; intercepts popstate.
  useModalBackClose(previewDoc !== null, () => setPreviewDoc(null));
  useModalBackClose(rejectingDoc !== null, () => {
    setRejectingDoc(null);
    setRejectReason('');
  });

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await ordersAPI.getDocuments(bookingId);
      setDocs(Array.isArray(data) ? (data as DocumentRecord[]) : []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  // Approve goes straight through. Reject opens the in-app modal so the
  // admin types the reason in a styled textarea — replaces the browser
  // window.prompt() which had the ugly "The page at … says" chrome.
  const act = (doc: DocumentRecord, status: 'approved' | 'rejected'): void => {
    if (status === 'approved') {
      void runVerify(doc, 'approved', '');
      return;
    }
    setRejectingDoc(doc);
    setRejectReason('');
    setActionError(null);
  };

  const runVerify = async (
    doc: DocumentRecord,
    status: 'approved' | 'rejected',
    notes: string,
  ): Promise<void> => {
    setBusyId(doc.id);
    setActionError(null);
    try {
      const updated = await documentsAPI.verify(doc.id, { status, notes });
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? {
                ...d,
                ...(updated && typeof updated === 'object' ? (updated as Partial<DocumentRecord>) : {}),
                is_verified: status === 'approved',
                notes: notes || d.notes,
              }
            : d,
        ),
      );
      // Reject succeeded → close the modal.
      if (status === 'rejected') setRejectingDoc(null);
    } catch (e: any) {
      // Show inside the modal if open, otherwise fall back to a styled
      // toast-equivalent (the browser alert was the original ugly thing
      // we're getting rid of, so we use an inline error pill instead).
      const msg = e?.message || 'Could not update document.';
      setActionError(msg);
      if (status !== 'rejected') {
        // For approve failures (no modal open), surface inline so the
        // admin sees what's wrong — no native alert popup.
        alert(msg);
      }
    } finally {
      setBusyId(null);
      setRejectSubmitting(false);
    }
  };

  const submitReject = async (): Promise<void> => {
    if (!rejectingDoc) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setActionError('Please enter a reason for rejection.');
      return;
    }
    setRejectSubmitting(true);
    await runVerify(rejectingDoc, 'rejected', trimmed);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">Documents</h3>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading documents…</p>
      ) : error ? (
        <p className="text-sm text-red-700">Failed: {error}</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-500">No documents uploaded for this booking yet.</p>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => {
            const pending = !d.is_verified;
            const isImage = isImageDoc(d);
            return (
              <li key={d.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-3">
                  {/* Inline thumbnail — click for full preview. Falls back to
                      a 📄 tile for PDFs / non-image files OR when an image
                      fails to load (Render's ephemeral disk wiped it). */}
                  {isImage && d.file_url ? (
                    <DocThumbnail doc={d} onClick={() => setPreviewDoc(d)} />
                  ) : (
                    <button
                      onClick={() => d.file_url && window.open(d.file_url, '_blank')}
                      disabled={!d.file_url}
                      className="w-20 h-20 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-3xl hover:bg-gray-100 disabled:opacity-50"
                      title="Open file"
                    >
                      📄
                    </button>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {(d.document_type || 'document').replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{d.file_name}</p>
                        {d.notes && <p className="text-xs text-gray-500 mt-1">Note: {d.notes}</p>}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          d.is_verified
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {d.is_verified ? 'approved' : 'pending'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {d.file_url && (
                        <button
                          onClick={() => (isImage ? setPreviewDoc(d) : window.open(d.file_url, '_blank'))}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {isImage ? 'Preview' : 'Open file'}
                        </button>
                      )}
                      {canVerify && (
                        <>
                          {pending && (
                            <button
                              disabled={busyId === d.id}
                              onClick={() => act(d, 'approved')}
                              className="ml-auto px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          <button
                            disabled={busyId === d.id}
                            onClick={() => act(d, 'rejected')}
                            className={`${pending ? '' : 'ml-auto'} px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50`}
                          >
                            {pending ? 'Reject' : 'Revoke'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Full-screen image preview modal — opens when admin clicks a thumbnail
          or the Preview link. Click backdrop or ✕ to dismiss. */}
      {previewDoc && previewDoc.file_url && (
        <DocPreviewOverlay
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {/* ─── Reject reason modal ─────────────────────────────────────────
          Replaces the browser window.prompt() with a styled in-app modal
          matching the rest of the dashboard — no more "The page at … says"
          header. Auto-focuses the textarea, supports Esc to cancel and
          Cmd/Ctrl+Enter to submit. */}
      {rejectingDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !rejectSubmitting && setRejectingDoc(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Reject document</h3>
              <p className="text-xs text-gray-500 mt-1">
                {(rejectingDoc.document_type || 'document').replace(/_/g, ' ')}
                {' · '}
                <span className="text-gray-400">{rejectingDoc.file_name}</span>
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason for rejection <span className="text-red-500">*</span>
              </label>
              <textarea
                autoFocus
                rows={4}
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  if (actionError) setActionError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !rejectSubmitting) setRejectingDoc(null);
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submitReject();
                }}
                placeholder="e.g. Image is blurry, please re-upload a clearer photo"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                disabled={rejectSubmitting}
              />
              {actionError && (
                <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  {actionError}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                The customer will see this note next to the document and can re-upload.
              </p>
            </div>
            <div className="px-5 py-3 bg-gray-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectingDoc(null)}
                disabled={rejectSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitReject()}
                disabled={rejectSubmitting || !rejectReason.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {rejectSubmitting ? 'Rejecting…' : 'Reject document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type CheckKey = 'identity' | 'contact' | 'address' | 'payment' | 'scope';

interface ChecklistItem {
  key: CheckKey;
  label: string;
}

interface VerificationChecklistProps {
  checks: Partial<Record<CheckKey, boolean>>;
  onToggle: (key: CheckKey) => void;
  disabled?: boolean;
}

function VerificationChecklist({ checks, onToggle, disabled }: VerificationChecklistProps) {
  const items: ChecklistItem[] = [
    { key: 'identity', label: 'Customer identity confirmed' },
    { key: 'contact', label: 'Phone / email reachable' },
    { key: 'address', label: 'Service address validated' },
    { key: 'payment', label: 'Payment method confirmed' },
    { key: 'scope', label: 'Service scope & price agreed' },
  ];
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <label key={it.key} className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!checks[it.key]}
            onChange={() => onToggle(it.key)}
            disabled={disabled}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <span className={`text-sm ${checks[it.key] ? 'text-gray-900' : 'text-gray-600'}`}>
            {it.label}
          </span>
        </label>
      ))}
    </div>
  );
}

interface AssignmentLogEntry {
  agentId: string;
  agentName?: string;
  reason: string;
  at: string;
}

export interface OrderManagementProps {
  userRole?: string;
}

export default function OrderManagement({ userRole = 'super_admin' }: OrderManagementProps) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | OrderStatus>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<Record<string, Partial<Record<CheckKey, boolean>>>>({});
  const [assignmentReason, setAssignmentReason] = useState<string>('');
  const [assignmentLog, setAssignmentLog] = useState<Record<string, AssignmentLogEntry[]>>({});
  // Toast — green confirmation after a successful agent assignment.
  // Auto-dismisses 3s after appearing. Lives inside this component so
  // it's scoped to the orders flow only.
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const canVerify = can(userRole, CAP.ORDER_VERIFY);
  const canAssign = can(userRole, CAP.ORDER_ASSIGN);
  const canCancel = can(userRole, CAP.ORDER_CANCEL);
  const canReschedule = can(userRole, CAP.ORDER_RESCHEDULE);
  const readOnly = !canVerify && !canAssign && !canCancel && !canReschedule;
  const b2bOnly = can(userRole, CAP.SCOPE_B2B_ONLY);
  const canExport = userRole === 'super_admin';

  const exportBookings = (): void => {
    downloadCsv<OrderRecord>(`bookings-${new Date().toISOString().slice(0, 10)}.csv`, orders, [
      { key: 'id', label: 'booking_id' },
      { key: 'ref', label: 'ref', value: (o) => refOf(o) },
      { key: 'status', label: 'status' },
      { key: 'booking_type', label: 'type' },
      { key: 'created_at', label: 'created_at' },
      {
        key: 'customer',
        label: 'customer_name',
        value: (o) => o.customer?.name || o.customer_name || '',
      },
      {
        key: 'applicant_name',
        label: 'applicant_name',
        value: (o) => o.applicant_name || '',
      },
      {
        key: 'customer_mobile',
        label: 'customer_mobile',
        value: (o) => o.customer?.mobile || o.customer_mobile || '',
      },
      { key: 'service', label: 'service', value: (o) => o.service?.name || '' },
      { key: 'agent', label: 'agent', value: (o) => o.agent?.name || '' },
      { key: 'final_price', label: 'final_price' },
      { key: 'price_quoted', label: 'price_quoted' },
      { key: 'payment_status', label: 'payment_status' },
    ]);
  };

  useEffect(() => {
    const load = async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params: Record<string, unknown> = { page: 1, limit: 50 };
        if (filterStatus !== 'all') params.status = filterStatus;
        if (b2bOnly) params.booking_type = 'industrial';
        const [ordersData, agentsData] = await Promise.all([
          ordersAPI.getAll(params),
          // Show ALL active reps in the dropdown — KYC status is rendered
          // as a badge inside each option so the admin can see at a glance
          // who's fully verified vs pending. Filtering only-verified hid
          // legitimate reps during testing/demo.
          canAssign
            ? agentsAPI.getAll({ status: 'active' })
            : Promise.resolve([]),
        ]);
        setOrders(Array.isArray(ordersData) ? (ordersData as OrderRecord[]) : []);
        setAgents(Array.isArray(agentsData) ? (agentsData as AgentLite[]) : []);
      } catch (e: any) {
        if (!silent) setError(e.message);
      } finally {
        if (!silent) setLoading(false);
      }
    };
    load();
    // Auto-refresh every 20s so newly-created customer bookings show up
    // without the admin having to hit refresh. `silent: true` keeps the
    // existing list visible during the refetch (no spinner flash).
    const pollId = setInterval(() => load(true), 20_000);
    return () => clearInterval(pollId);
  }, [filterStatus, b2bOnly, canAssign]);

  const filteredOrders = useMemo<OrderRecord[]>(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((o) => {
      if (!q) return true;
      return (
        refOf(o).toLowerCase().includes(q) ||
        (o.customer?.name || '').toLowerCase().includes(q) ||
        (o.service?.name || '').toLowerCase().includes(q)
      );
    });
  }, [orders, searchTerm]);

  const selected = orders.find((o) => o.id === selectedId) || null;

  // Scroll the detail panel into view after React commits the new content.
  useEffect(() => {
    if (!selectedId || typeof document === 'undefined') return;
    const panel = document.getElementById('order-detail-panel');
    if (!panel) return;
    requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [selectedId]);

  // ─── History-tracked Review-and-Act selection ────────────────────
  // When an order is opened, push `#orders/<id>` so browser back
  // clears the selection (back stack: dashboard → orders → order-id
  // → … → exits dashboard). When popstate fires and the hash no
  // longer carries an order id, clear selectedId. The historyDriven
  // flag prevents an infinite push/pop loop.
  const historyDrivenRef = useRef<boolean>(false);

  const openOrder = useCallback((id: string): void => {
    setSelectedId(id);
    if (typeof window === 'undefined') return;
    if (historyDrivenRef.current) return;
    const targetHash = `#orders/${id}`;
    if (window.location.hash !== targetHash) {
      window.history.pushState({ section: 'orders', orderId: id }, '', targetHash);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPop = (e: PopStateEvent): void => {
      const state = (e.state as { section?: string; orderId?: string } | null) || null;
      const hashTail = window.location.hash.replace(/^#orders\/?/, '');
      const orderIdFromHash =
        state?.section === 'orders' && state?.orderId
          ? state.orderId
          : hashTail && hashTail !== window.location.hash.replace(/^#/, '')
          ? hashTail
          : null;
      historyDrivenRef.current = true;
      setSelectedId(orderIdFromHash || null);
      setTimeout(() => {
        historyDrivenRef.current = false;
      }, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const checks: Partial<Record<CheckKey, boolean>> = (selected && verifyState[selected.id]) || {};
  const allVerified =
    !!selected &&
    (['identity', 'contact', 'address', 'payment', 'scope'] as CheckKey[]).every((k) => checks[k]);

  const toggleCheck = (key: CheckKey): void => {
    if (!selected) return;
    setVerifyState((prev) => ({
      ...prev,
      [selected.id]: { ...(prev[selected.id] || {}), [key]: !(prev[selected.id] || {})[key] },
    }));
  };

  const handleAssign = async (agentId: string): Promise<void> => {
    if (!selected || !agentId) return;
    const reason = assignmentReason.trim();
    if (!reason) {
      alert('Please enter a reason for this assignment.');
      return;
    }
    if (selected.status && selected.status !== 'pending') {
      const confirmOverride = confirm(
        `This booking is already ${selected.status.replace('_', ' ')}.\n\n` +
          `The backend only accepts assignment when status is "pending". ` +
          `Continue anyway?`,
      );
      if (!confirmOverride) return;
    }
    const agent = agents.find((a) => String(a.id) === String(agentId));
    try {
      await ordersAPI.assignAgent(selected.id, agentId);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === selected.id ? { ...o, agent: agent || o.agent, status: 'assigned' } : o,
        ),
      );
      setAssignmentLog((prev) => ({
        ...prev,
        [selected.id]: [
          ...(prev[selected.id] || []),
          { agentId, agentName: agent?.name, reason, at: new Date().toISOString() },
        ],
      }));
      setAssignmentReason('');
      // Toast confirmation. The agent gets notified via push + in-app
      // banner separately (backend writes a Notification row on this
      // assignment); the toast is for the admin doing the action.
      setToast({
        kind: 'success',
        message: `Representative ${agent?.name || 'assigned'} successfully — they've been notified.`,
      });
      setTimeout(() => setToast(null), 3500);
    } catch (e: any) {
      setToast({ kind: 'error', message: `Assignment failed: ${e.message}` });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleReschedule = async (): Promise<void> => {
    if (!selected) return;
    const preferred_date = prompt(
      'New date (YYYY-MM-DD). Leave blank to keep existing.',
      selected.preferred_date || '',
    );
    const preferred_time = prompt(
      'New time window (e.g. "14:00 - 15:00"). Leave blank to keep existing.',
      selected.preferred_time || '',
    );
    if (!preferred_date && !preferred_time) return;
    const reason = prompt('Reason for reschedule (optional):') || '';
    try {
      const updated = await ordersAPI.reschedule(selected.id, {
        preferred_date: preferred_date || undefined,
        preferred_time: preferred_time || undefined,
        reason,
      });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === selected.id
            ? { ...o, ...((updated || {}) as Partial<OrderRecord>) }
            : o,
        ),
      );
    } catch (e: any) {
      alert(`Reschedule failed: ${e.message}`);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!selected) return;
    const reason = prompt(`Cancel booking ${refOf(selected)}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    try {
      await ordersAPI.cancel(selected.id, { reason: reason.trim() });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === selected.id
            ? {
                ...o,
                status: 'cancelled',
                cancellation_reason: reason.trim(),
                cancelled_at: new Date().toISOString(),
              }
            : o,
        ),
      );
    } catch (e: any) {
      alert(`Cancel failed: ${e.message}`);
    }
  };

  const statusCounts = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const s of STATUS_ORDER) c[s.key] = 0;
    for (const o of orders) {
      const k = o.status as string | undefined;
      if (k && c[k] !== undefined) c[k] += 1;
    }
    return c;
  }, [orders]);

  return (
    <div className="space-y-6">
      {/* Floating toast — surfaces success/error after admin actions
          like agent assignment. Slides in from the bottom-right; auto-
          dismisses after a few seconds. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-[9998] max-w-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            toast.kind === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
          style={{ animation: 'slideInUp 0.25s ease-out' }}
        >
          <span className="text-xl">{toast.kind === 'success' ? '✓' : '⚠'}</span>
          <span className="text-sm font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Order Management</h2>
          <p className="text-xs text-gray-500">
            {b2bOnly
              ? 'Industrial bookings only — your B2B/Industrial Admin scope'
              : 'All live bookings across consumer and industrial services'}
            {readOnly && ' · read-only for your role'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | OrderStatus)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All ({statusCounts.all})</option>
            {STATUS_ORDER.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({statusCounts[s.key] || 0})
              </option>
            ))}
          </select>
          <div className="relative">
            <input
              type="text"
              placeholder="Search ref / customer / service"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          {canExport && orders.length > 0 && (
            <button
              onClick={exportBookings}
              className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700"
              title="Download current list as CSV"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {loading && orders.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
              Loading bookings…
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center text-gray-500">
              No orders match the current filter.
            </div>
          ) : (
            filteredOrders.map((o) => {
              const isSelected = selectedId === o.id;
              return (
                <div
                  key={o.id}
                  className={`bg-white rounded-lg shadow p-5 border transition lift fade-in-up
                    ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:shadow-md'}`}
                >
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{refOf(o)}</h3>
                      <p className="text-xs text-gray-500">
                        {o.created_at ? new Date(o.created_at).toLocaleString() : ''}
                        {o.booking_type ? ` · ${o.booking_type}` : ''}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        statusTone[o.status as OrderStatus] || 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {(o.status || '').replace('_', ' ')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">Customer</p>
                      <p className="text-gray-600">{o.customer?.name || '—'}</p>
                      <p className="text-xs text-gray-500">
                        {o.customer?.mobile || o.customer?.email || ''}
                      </p>
                      {/* Applicant = the person the service is FOR.
                          Shown only when different from the customer
                          (i.e. customer booked on a family member's
                          behalf) — otherwise it'd just duplicate. */}
                      {o.applicant_name &&
                        o.applicant_name !== (o.customer?.name || o.customer_name) && (
                          <p className="mt-1 text-xs text-indigo-700">
                            <span className="font-medium">Applicant:</span>{' '}
                            {o.applicant_name}
                          </p>
                        )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Service</p>
                      <p className="text-gray-600">{o.service?.name || '—'}</p>
                      <p className="font-medium text-gray-900">
                        {money(Number(o.final_price) || Number(o.price_quoted) || 0)}
                      </p>
                    </div>
                  </div>

                  {o.agent && (
                    <div className="mt-3 text-sm">
                      <p className="font-medium text-gray-900">Assigned Representative</p>
                      <p className="text-gray-600">
                        {o.agent.name} {o.agent.rating ? `(⭐ ${o.agent.rating})` : ''}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => openOrder(o.id)}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {readOnly ? 'View details' : 'Review & act'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div id="order-detail-panel" className="space-y-6 scroll-mt-20">
          {!selected ? (
            <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-sm text-gray-500">
              {readOnly
                ? 'Select an order to view its details. Your role is read-only for bookings.'
                : 'Select an order to verify customer details, override representative assignment, and track its stage.'}
            </div>
          ) : (
            <>
              {/* Customer detail verification */}
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Customer Details</h3>
                <p className="text-xs text-gray-500 mb-4">
                  {canVerify
                    ? 'Step through each verification item. When complete, you can safely override or confirm assignment.'
                    : 'Contact and service details for this booking.'}
                </p>
                <div className="space-y-3 text-sm mb-4">
                  <div>
                    <p className="font-medium text-gray-900">{selected.customer?.name || '—'}</p>
                    <p className="text-gray-600">{selected.customer?.mobile}</p>
                    <p className="text-gray-600">{selected.customer?.email}</p>
                  </div>
                  {/* Applicant block — ALWAYS rendered so the operator
                      can confirm who the service is FOR even when the
                      booking customer is the applicant themselves.
                      Shows the captured name when present; otherwise
                      falls back to "Same as customer" so the field is
                      never silently absent. */}
                  {(() => {
                    const customerLabel =
                      selected.customer?.name || selected.customer_name || '';
                    const applicant = (selected.applicant_name || '').trim();
                    const sameAsCustomer =
                      !applicant ||
                      applicant.toLowerCase() === customerLabel.toLowerCase();
                    return (
                      <div className="rounded-md bg-indigo-50 border border-indigo-200 p-3">
                        <p className="text-xs font-medium text-indigo-700 uppercase tracking-wide">
                          Applicant
                        </p>
                        <p className="text-sm font-semibold text-gray-900">
                          {sameAsCustomer
                            ? customerLabel || '—'
                            : applicant}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {sameAsCustomer
                            ? 'The customer is the applicant for this service.'
                            : `Service is for this person; the booking was placed by ${customerLabel || 'the customer above'}.`}
                        </p>
                      </div>
                    );
                  })()}
                  {selected.address && (
                    <div>
                      <p className="font-medium text-gray-900">Address</p>
                      <p className="text-gray-600">{selected.address}</p>
                    </div>
                  )}
                  {selected.notes && (
                    <div>
                      <p className="font-medium text-gray-900">Notes</p>
                      {/* Strip the raw enquiry UUID the backend stamps
                          on B2B-converted bookings ("Converted from
                          B2B enquiry:c0ad795f-…"). The UUID is needed
                          server-side for the conversion-lookup query
                          but reads as noise in the admin UI — we
                          collapse it to "Converted from B2B enquiry"
                          on display. */}
                      <p className="text-gray-600 whitespace-pre-wrap">
                        {selected.notes.replace(
                          /Converted from B2B enquiry:[0-9a-f-]+/gi,
                          'Converted from B2B enquiry',
                        )}
                      </p>
                    </div>
                  )}
                </div>
                {canVerify && (
                  <>
                    <VerificationChecklist checks={checks} onToggle={toggleCheck} />
                    <div className="mt-4 text-xs">
                      {allVerified ? (
                        <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded-full">
                          ✓ Verified — ready for assignment
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">
                          Verification incomplete
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Payment trail — shows the Razorpay/online-payment breakdown
                  whenever it exists. For paid bookings, surfaces method +
                  transaction id + amount + paid timestamp so finance has
                  everything they need to reconcile. For unpaid bookings,
                  shows just the pending status. */}
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Payment</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Razorpay / online-payment trail for this booking.
                </p>
                {selected.payment_status === 'paid' ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Status</span>
                      <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                        ✓ Paid
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Amount</span>
                      <span className="font-semibold text-gray-900">
                        ₹{selected.amount_paid ?? selected.final_price ?? selected.price_quoted ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Method</span>
                      <span className="font-semibold text-gray-900 uppercase">
                        {selected.payment_method || 'online'}
                      </span>
                    </div>
                    {selected.transaction_id && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-500 shrink-0">Transaction ID</span>
                        <button
                          type="button"
                          className="font-mono text-xs text-blue-600 hover:underline truncate"
                          onClick={() => {
                            navigator.clipboard?.writeText(String(selected.transaction_id));
                          }}
                          title="Click to copy"
                        >
                          {selected.transaction_id}
                        </button>
                      </div>
                    )}
                    {selected.paid_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Paid at</span>
                        <span className="text-gray-700 text-xs">
                          {new Date(selected.paid_at).toLocaleString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                ) : selected.payment_status === 'refunded' ? (
                  <div className="text-sm">
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold">
                      Refunded
                    </span>
                  </div>
                ) : (
                  <div className="text-sm">
                    <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold">
                      Payment pending
                    </span>
                    <p className="text-xs text-gray-500 mt-2">
                      Booking is created but payment hasn&apos;t been collected yet.
                      Customer pays after the rep marks the work complete.
                    </p>
                  </div>
                )}
              </div>

              {canAssign && (
                <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Assign / Override Representative
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Pick a representative and add a short reason for the
                    assignment. Reassignments are recorded in the order history.
                  </p>
                  {!allVerified && (
                    <p className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-2 mb-3">
                      Customer verification isn&apos;t complete yet. You can still assign, but
                      ticking the checks first is recommended.
                    </p>
                  )}
                  <input
                    type="text"
                    placeholder="Reason for this assignment (required)"
                    value={assignmentReason}
                    onChange={(e) => setAssignmentReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 mb-3"
                  />
                  <select
                    disabled={!assignmentReason.trim() || agents.length === 0}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) handleAssign(v);
                      e.target.value = '';
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {agents.length === 0
                        ? 'No active representatives in the system'
                        : 'Select representative to assign…'}
                    </option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.mobile || String(a.id).slice(0, 8)}
                        {a.is_kyc_verified ? ' · ✅ KYC' : ' · ⚠ KYC pending'}
                        {a.online_status ? ' · 🟢 online' : ' · ⚪ offline'}
                        {Number(a.rating) > 0 ? ` · ⭐ ${Number(a.rating).toFixed(1)}` : ''}
                        {a.total_jobs_completed !== undefined
                          ? ` · ${a.total_jobs_completed} jobs`
                          : ''}
                      </option>
                    ))}
                  </select>
                  {!assignmentReason.trim() && agents.length > 0 && (
                    <p className="text-[10px] text-gray-500 mt-2">
                      ↑ Enter a reason first, then pick a representative from the dropdown.
                    </p>
                  )}
                  {agents.length === 0 && (
                    <p className="text-[10px] text-gray-500 mt-2">
                      No active representatives yet. Representatives appear here once
                      they sign up via the Representative app. KYC-verified reps are
                      flagged with ✅; unverified ones with ⚠ — both can be assigned,
                      but verified reps are recommended for production work.
                    </p>
                  )}
                  {(assignmentLog[selected.id] || []).length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium text-gray-700 mb-2">Assignment history</p>
                      <ul className="space-y-1">
                        {(assignmentLog[selected.id] || []).map((entry, i) => (
                          <li key={i} className="text-xs text-gray-600">
                            · {new Date(entry.at).toLocaleTimeString()} —{' '}
                            {entry.agentName || entry.agentId}: {entry.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {(canReschedule || canCancel) &&
                selected.status !== 'cancelled' &&
                selected.status !== 'completed' && (
                  <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Booking actions</h3>
                    <div className="flex gap-2">
                      {canReschedule && (
                        <button
                          onClick={handleReschedule}
                          className="flex-1 px-3 py-2 border border-blue-300 text-blue-700 text-sm rounded hover:bg-blue-50"
                        >
                          Reschedule
                        </button>
                      )}
                      {canCancel && (
                        <button
                          onClick={handleCancel}
                          className="flex-1 px-3 py-2 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50"
                        >
                          Cancel booking
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-2">
                      Current slot: {selected.preferred_date || '—'} {selected.preferred_time || ''}
                    </p>
                  </div>
                )}

              <DocumentsReview bookingId={selected.id} canVerify={can(userRole, CAP.DOCUMENT_VERIFY)} />

              {/* Order stage tracking */}
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Stage Tracking</h3>
                <StagePipeline status={selected.status} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
