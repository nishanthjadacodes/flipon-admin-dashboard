'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { b2bAPI, vaultAPI } from '@/utils/api';
import { CAP, can } from '@/utils/rbac';

// Corporate document vault — B2B/Industrial Admin scope per PDF.
// Documents are encrypted at rest server-side; download link is auth-checked.

type VaultTier = 'standard' | 'sensitive' | 'deliverable';

const TIER_TONE: Record<VaultTier, string> = {
  standard: 'bg-gray-100 text-gray-700',
  sensitive: 'bg-amber-100 text-amber-800',
  deliverable: 'bg-emerald-100 text-emerald-800',
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const shortId = (id: unknown): string =>
  typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');
const bytesLabel = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
};

interface CompanyProfile {
  legal_entity_name?: string;
  brand_name?: string;
  gstin?: string;
}

interface ServiceLite {
  name?: string;
}

interface Enquiry {
  id: string;
  status?: string;
  service?: ServiceLite;
  companyProfile?: CompanyProfile;
}

interface VaultDocument {
  id: string;
  original_name: string;
  mime_type?: string;
  plaintext_size?: number;
  created_at?: string;
  note?: string;
  tier?: VaultTier;
  visible_to_customer?: boolean;
}

interface UploadModalProps {
  enquiryId: string;
  onClose: () => void;
  onUploaded?: () => void;
}

function UploadModal({ enquiryId, onClose, onUploaded }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [tier, setTier] = useState<VaultTier>('standard');
  const [note, setNote] = useState<string>('');
  const [visibleToCustomer, setVisibleToCustomer] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErr(null);
    if (!file) {
      setErr('Pick a file first.');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('enquiry_id', enquiryId);
    fd.append('tier', tier);
    if (note.trim()) fd.append('note', note.trim());
    fd.append('visible_to_customer', String(visibleToCustomer));
    setBusy(true);
    try {
      await vaultAPI.upload(fd);
      onUploaded?.();
      onClose();
    } catch (e2: any) {
      setErr(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg p-6 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-semibold text-gray-900">Upload corporate document</h3>
        <p className="text-xs text-gray-500">Encrypted at rest. Every download is audit-logged.</p>
        {err && (
          <div className="p-2 text-sm rounded bg-red-50 border border-red-200 text-red-800">
            {err}
          </div>
        )}

        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">File</span>
          <input
            type="file"
            required
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full text-sm file:mr-3 file:px-3 file:py-1 file:border file:border-gray-300 file:rounded file:bg-gray-50"
          />
          {file && (
            <span className="text-xs text-gray-500 block mt-1">
              {file.name} · {bytesLabel(file.size)}
            </span>
          )}
        </label>

        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as VaultTier)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="standard">standard — general corporate doc</option>
            <option value="sensitive">sensitive — restricted access</option>
            <option value="deliverable">deliverable — NOC / licence / final output</option>
          </select>
        </label>

        <label className="text-sm block">
          <span className="block text-gray-700 mb-1">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. GSTIN certificate copy"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label className="text-sm flex items-center space-x-2">
          <input
            type="checkbox"
            checked={visibleToCustomer}
            onChange={(e) => setVisibleToCustomer(e.target.checked)}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <span className="text-gray-700">Visible to the customer in their app</span>
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Encrypting & uploading…' : 'Upload'}
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

export interface DocumentVaultProps {
  userRole?: string;
}

export default function DocumentVault({ userRole = 'b2b_admin' }: DocumentVaultProps) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [selectedEnquiry, setSelectedEnquiry] = useState<Enquiry | null>(null);
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loadingEnquiries, setLoadingEnquiries] = useState<boolean>(true);
  const [loadingDocs, setLoadingDocs] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showUpload, setShowUpload] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  const canUpload = can(userRole, CAP.VAULT_UPLOAD);
  const canDelete = can(userRole, CAP.VAULT_DELETE);

  const loadEnquiries = async (): Promise<void> => {
    setLoadingEnquiries(true);
    setError(null);
    try {
      const data = await b2bAPI.listEnquiries({ limit: 200 });
      setEnquiries(Array.isArray(data) ? (data as Enquiry[]) : []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoadingEnquiries(false);
    }
  };

  useEffect(() => {
    loadEnquiries();
  }, []);

  const loadDocs = async (enquiryId: string): Promise<void> => {
    setLoadingDocs(true);
    try {
      const data = await vaultAPI.listForEnquiry(enquiryId);
      setDocs(Array.isArray(data) ? (data as VaultDocument[]) : []);
    } catch (e: any) {
      setActionMsg(`Failed to load vault: ${e.message || String(e)}`);
      setDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  };

  const openEnquiry = (e: Enquiry): void => {
    setSelectedEnquiry(e);
    setActionMsg(null);
    loadDocs(e.id);
  };

  const handleDelete = async (doc: VaultDocument): Promise<void> => {
    if (!canDelete) return;
    if (!confirm(`Delete "${doc.original_name}"? This removes the encrypted file and the metadata.`))
      return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await vaultAPI.delete(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      setActionMsg(`Deleted ${doc.original_name}`);
    } catch (e: any) {
      setActionMsg(`Delete failed: ${e.message || String(e)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const filteredEnquiries = useMemo<Enquiry[]>(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return enquiries;
    return enquiries.filter(
      (e) =>
        String(e.id).toLowerCase().includes(q) ||
        (e.service?.name || '').toLowerCase().includes(q) ||
        ((e.companyProfile?.legal_entity_name || e.companyProfile?.brand_name) || '')
          .toLowerCase()
          .includes(q) ||
        (e.companyProfile?.gstin || '').toLowerCase().includes(q),
    );
  }, [enquiries, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Document Vault</h2>
          <p className="text-xs text-gray-500">
            Encrypted corporate documents, licences, and heavy files scoped per industrial enquiry.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Search enquiry / GSTIN / service"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          <button
            onClick={loadEnquiries}
            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
          Failed to load enquiries: {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">
            Enquiries ({filteredEnquiries.length})
          </h3>
          {loadingEnquiries ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : filteredEnquiries.length === 0 ? (
            <p className="text-sm text-gray-500">No enquiries match.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {filteredEnquiries.map((e) => {
                const isSelected = selectedEnquiry?.id === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => openEnquiry(e)}
                    className={`w-full text-left bg-white border rounded-lg p-3 transition ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-gray-200 hover:shadow-md'
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {e.service?.name || 'Industrial service'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {(e.companyProfile?.legal_entity_name || e.companyProfile?.brand_name) ||
                        'Unlinked company'}
                      {e.companyProfile?.gstin ? ` · ${e.companyProfile.gstin}` : ''}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-gray-500 font-mono">{shortId(e.id)}</span>
                      <span className="text-[10px] text-gray-600 capitalize">
                        {(e.status || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {!selectedEnquiry ? (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500">
              Pick an enquiry on the left to view its encrypted document vault.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {selectedEnquiry.service?.name || 'Industrial service'}
                    </h3>
                    <p className="text-xs text-gray-500 font-mono">{selectedEnquiry.id}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {(selectedEnquiry.companyProfile?.legal_entity_name ||
                        selectedEnquiry.companyProfile?.brand_name) ||
                        'Unlinked company'}
                      {selectedEnquiry.companyProfile?.gstin
                        ? ` · GSTIN ${selectedEnquiry.companyProfile.gstin}`
                        : ''}
                    </p>
                  </div>
                  {canUpload && (
                    <button
                      onClick={() => setShowUpload(true)}
                      className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                    >
                      + Upload document
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900 text-sm">Vault contents</h4>
                  <span className="text-xs text-gray-500">
                    {docs.length} document{docs.length === 1 ? '' : 's'}
                  </span>
                </div>
                {loadingDocs ? (
                  <p className="p-4 text-sm text-gray-500">Loading vault…</p>
                ) : docs.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">
                    No documents uploaded to this enquiry yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {docs.map((d) => (
                      <li key={d.id} className="p-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {d.original_name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {d.mime_type || 'file'} · {bytesLabel(d.plaintext_size)} · uploaded{' '}
                            {fmtDate(d.created_at)}
                          </p>
                          {d.note && <p className="text-xs text-gray-600 mt-1">Note: {d.note}</p>}
                          <div className="flex flex-wrap gap-1 mt-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                TIER_TONE[d.tier as VaultTier] || TIER_TONE.standard
                              }`}
                            >
                              {d.tier || 'standard'}
                            </span>
                            {d.visible_to_customer ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-800">
                                visible to customer
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700">
                                internal
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <a
                            href={vaultAPI.downloadUrl(d.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1 bg-gray-900 text-white text-xs rounded hover:bg-gray-700 text-center"
                          >
                            Download
                          </a>
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(d)}
                              disabled={actionBusy}
                              className="px-3 py-1 border border-red-300 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showUpload && selectedEnquiry && (
        <UploadModal
          enquiryId={selectedEnquiry.id}
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setActionMsg('Document uploaded');
            loadDocs(selectedEnquiry.id);
          }}
        />
      )}
    </div>
  );
}
