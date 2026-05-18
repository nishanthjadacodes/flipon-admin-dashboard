// API client — talks directly to the FlipOn backend deployed on Render.
// No client-side auth: the backend's ADMIN_DEV_OPEN=true env flag bypasses
// the JWT check so the admin panel works without a login screen while we
// iterate. Once real admin auth ships, reintroduce a token layer here.

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://flipon-backend.onrender.com/api';

interface ApiError extends Error {
  status?: number;
  body?: unknown;
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

interface CacheEntry {
  value: unknown;
  at: number;
}

// Simple in-memory GET cache so clicking between tabs doesn't re-hit the network.
// Entries TTL out after 60s; any mutation clears the whole cache to avoid stale
// writes. Not meant for server rendering — it lives on the window only.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export const invalidateCache = (): void => {
  cache.clear();
  inflight.clear();
};

const apiRequest = async <T = unknown>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> => {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const cacheKey: string | null = isGet ? endpoint : null;

  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const pending = inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const doFetch = async (): Promise<T> => {
    const isFormData = options.body instanceof FormData;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers || {}),
        },
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error(
          `Request timed out after ${Math.round(timeoutMs / 1000)}s — backend may be waking up. Try again.`,
        );
      }
      throw new Error(`Network error: ${e.message || 'unreachable'}`);
    }
    clearTimeout(timeoutId);

    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const msg = (body && body.message) || `API ${response.status} ${response.statusText}`;
      const err: ApiError = new Error(msg);
      err.status = response.status;
      err.body = body;
      throw err;
    }

    // Backend responds with { success, data, message?, pagination? }. Unwrap `data`
    // when present so callers deal with clean shapes.
    const value =
      body && typeof body === 'object' && 'data' in body ? body.data : body;

    if (cacheKey) cache.set(cacheKey, { value, at: Date.now() });
    if (!isGet) invalidateCache();
    return value as T;
  };

  if (cacheKey) {
    const p = doFetch().finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  }
  return doFetch();
};

const qs = (params: Record<string, unknown>): string => {
  const s = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return s ? `?${s}` : '';
};

// ─── Flash Notifications ─────────────────────────────────────────────────
// Splash banners shown to the customer app pre-login. Super admin only —
// the dashboard's RBAC gate keeps non-super-admins out of the section UI.
export interface FlashNotification {
  id: string;
  title: string;
  body?: string | null;
  image_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  audience: 'all' | 'guest' | 'logged_in';
  priority: number;
  is_active: boolean;
  active_from?: string | null;
  active_until?: string | null;
  // Optional discount the customer app applies in Payment Summary
  // for any service whose name OR category contains
  // target_service_pattern (case-insensitive). Both fields must be
  // present + non-empty for the discount to take effect.
  discount_percent?: number | null;
  target_service_pattern?: string | null;
  created_at?: string;
  updated_at?: string;
}
export const flashNotificationsAPI = {
  list: (): Promise<unknown> => apiRequest('/flash-notifications'),
  create: (payload: Partial<FlashNotification>): Promise<unknown> =>
    apiRequest('/flash-notifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: Partial<FlashNotification>): Promise<unknown> =>
    apiRequest(`/flash-notifications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  remove: (id: string): Promise<unknown> =>
    apiRequest(`/flash-notifications/${id}`, { method: 'DELETE' }),
};

// ─── Dashboard ────────────────────────────────────────────────────────────
export const dashboardAPI = {
  getSummary: (): Promise<unknown> => apiRequest('/admin/dashboard/summary'),
  getStats: (): Promise<unknown> => apiRequest('/admin/dashboard/stats'),
  getRecentBookings: (limit: number = 5): Promise<unknown> =>
    apiRequest(`/admin/bookings${qs({ limit, page: 1 })}`),
  getPendingDocumentation: (): Promise<unknown> =>
    apiRequest('/admin/reports/pending-documentation'),
  getAgentPerformance: (limit: number = 20): Promise<unknown> =>
    apiRequest(`/admin/reports/agents${qs({ limit })}`),
};

// ─── Orders (= bookings in admin UI) ──────────────────────────────────────
export interface RescheduleOptions {
  preferred_date?: string;
  preferred_time?: string;
  reason?: string;
}

export interface CancelOptions {
  reason?: string;
}

export const ordersAPI = {
  getAll: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/bookings${qs(params)}`),
  assignAgent: (bookingId: string, agentId: string): Promise<unknown> =>
    apiRequest('/admin/bookings/assign-agent', {
      method: 'POST',
      body: JSON.stringify({ bookingId, agentId }),
    }),
  reschedule: (
    bookingId: string,
    { preferred_date, preferred_time, reason }: RescheduleOptions = {},
  ): Promise<unknown> =>
    apiRequest(`/admin/bookings/${bookingId}/reschedule`, {
      method: 'PUT',
      body: JSON.stringify({ preferred_date, preferred_time, reason }),
    }),
  cancel: (bookingId: string, { reason }: CancelOptions = {}): Promise<unknown> =>
    apiRequest(`/admin/bookings/${bookingId}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    }),
  getDocuments: (bookingId: string): Promise<unknown> =>
    apiRequest(`/documents/bookings/${bookingId}`),
};

// ─── Documents ────────────────────────────────────────────────────────────
export interface VerifyDocOptions {
  status?: 'approved' | 'rejected';
  notes?: string;
}

export const documentsAPI = {
  listPending: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/documents/admin/pending${qs(params)}`),
  verify: (id: string, { status = 'approved', notes }: VerifyDocOptions = {}): Promise<unknown> =>
    apiRequest(`/documents/${id}/verify`, {
      method: 'PUT',
      body: JSON.stringify({ status, notes }),
    }),
};

// ─── Agents ───────────────────────────────────────────────────────────────
export interface AgentStatusOptions {
  is_active?: boolean;
  is_verified?: boolean;
  is_kyc_verified?: boolean;
}

export interface AgentKycOptions {
  status?: 'verified' | 'rejected';
  notes?: string;
}

export const agentsAPI = {
  // 30-second cache-bust window — without it, the api helper's 60s
  // GET cache returns stale data and online_status changes from the
  // agent app take up to a full minute to surface in the admin's
  // representative-management list. Adding a `_t` param that ticks
  // every 30s makes the URL unique per refresh window so the silent-
  // refresh interval actually round-trips to the server.
  getAll: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(
      `/admin/users${qs({
        role: 'agent',
        _t: Math.floor(Date.now() / 30_000),
        ...params,
      })}`,
    ),
  getAvailable: (): Promise<unknown> => apiRequest('/admin/agents/available'),
  getPerformance: (limit?: number): Promise<unknown> =>
    apiRequest(`/admin/reports/agents${qs({ limit })}`),
  setStatus: (
    id: string,
    { is_active, is_verified, is_kyc_verified }: AgentStatusOptions = {},
  ): Promise<unknown> =>
    apiRequest(`/admin/users/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ is_active, is_verified, is_kyc_verified }),
    }),
  verifyKyc: (
    agentId: string,
    { status = 'verified', notes }: AgentKycOptions = {},
  ): Promise<unknown> =>
    apiRequest(`/kyc/admin/kyc/${agentId}/verify`, {
      method: 'PUT',
      body: JSON.stringify({ status, notes }),
    }),
  getKycPending: (): Promise<unknown> => apiRequest('/kyc/admin/kyc/pending'),
  getKycDetails: (agentId: string): Promise<unknown> =>
    apiRequest(`/kyc/admin/kyc/${agentId}`),

  // ─── Governance — Refer & Earn / Royalty policy section 4 ────────────
  // forfeitRoyalty: anti-poaching violation → forfeit royalty earnings
  //   for the rest of the current calendar quarter.
  // clearRoyaltyForfeit: reverse a previous forfeit (dispute resolved).
  // terminateForSelfReferral: confirmed self-referral via duplicate
  //   accounts → hard-deactivate + expire all pending referrals on
  //   either side. Permanent.
  forfeitRoyalty: (agentId: string, reason: string): Promise<unknown> =>
    apiRequest(`/admin/users/${agentId}/forfeit-royalty`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  clearRoyaltyForfeit: (agentId: string): Promise<unknown> =>
    apiRequest(`/admin/users/${agentId}/clear-royalty-forfeit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  terminateForSelfReferral: (agentId: string, reason: string): Promise<unknown> =>
    apiRequest(`/admin/users/${agentId}/terminate-self-referral`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

// ─── Services ─────────────────────────────────────────────────────────────
export const servicesAPI = {
  getAll: (): Promise<unknown> => apiRequest('/admin/services'),
  create: (data: Record<string, unknown>): Promise<unknown> =>
    apiRequest('/admin/services', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Record<string, unknown>): Promise<unknown> =>
    apiRequest(`/admin/services/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string): Promise<unknown> =>
    apiRequest(`/admin/services/${id}`, { method: 'DELETE' }),
};

// ─── Helpdesk ─────────────────────────────────────────────────────────────
export const helpdeskAPI = {
  getTickets: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/tickets${qs(params)}`),
  getTicketStats: (): Promise<unknown> => apiRequest('/admin/tickets/stats'),
  getTicketById: (id: string): Promise<unknown> => apiRequest(`/admin/tickets/${id}`),
  createTicket: (data: Record<string, unknown>): Promise<unknown> =>
    apiRequest('/admin/tickets', { method: 'POST', body: JSON.stringify(data) }),
  updateTicket: (id: string, data: Record<string, unknown>): Promise<unknown> =>
    apiRequest(`/admin/tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getTicketMessages: (id: string): Promise<unknown> =>
    apiRequest(`/admin/tickets/${id}/messages`),
  sendTicketMessage: (id: string, body: string): Promise<unknown> =>
    apiRequest(`/admin/tickets/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  getCustomers: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/users${qs({ role: 'customer', ...params })}`),
  getCustomerBookings: (
    customerId: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> =>
    apiRequest(
      `/admin/bookings${qs({ customer_id: customerId, limit: 50, ...params })}`,
    ),
};

// ─── Reports ──────────────────────────────────────────────────────────────
export const reportsAPI = {
  getOperational: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/operational${qs(params)}`),
  getAgentPerformance: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/agents${qs(params)}`),
  getRevenueSummary: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/revenue${qs(params)}`),
  getServiceDemand: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/service-demand${qs(params)}`),
  getZones: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/zones${qs(params)}`),
  getPendingDocumentation: (): Promise<unknown> =>
    apiRequest('/admin/reports/pending-documentation'),
  getDailyOperational: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/operational${qs(params)}`),
  getServiceDemandHeatmap: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/reports/service-demand${qs(params)}`),
};

// ─── Finance / Accounts ───────────────────────────────────────────────────
export interface PayoutCreatePayload {
  agent_id?: string;
  amount?: number;
  method?: string;
  note?: string;
}

export interface PayoutStatusPayload {
  status?: string;
  reference?: string;
  note?: string;
}

export const payoutsAPI = {
  list: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/payouts${qs(params)}`),
  stats: (): Promise<unknown> => apiRequest('/admin/payouts/stats'),
  create: ({ agent_id, amount, method, note }: PayoutCreatePayload = {}): Promise<unknown> =>
    apiRequest('/admin/payouts', {
      method: 'POST',
      body: JSON.stringify({ agent_id, amount, method, note }),
    }),
  setStatus: (id: string, { status, reference, note }: PayoutStatusPayload = {}): Promise<unknown> =>
    apiRequest(`/admin/payouts/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, reference, note }),
    }),
};

export interface RoyaltyGeneratePayload {
  period?: string;
}

export interface RoyaltyCommissionsPayload {
  period?: string;
  entries?: unknown[];
}

export interface RoyaltyStatusPayload {
  status?: string;
  notes?: string;
}

export const royaltyAPI = {
  list: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/royalty${qs(params)}`),
  summary: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/royalty/summary${qs(params)}`),
  generate: ({ period }: RoyaltyGeneratePayload = {}): Promise<unknown> =>
    apiRequest('/admin/royalty/generate', {
      method: 'POST',
      body: JSON.stringify({ period }),
    }),
  addCommissions: ({ period, entries }: RoyaltyCommissionsPayload = {}): Promise<unknown> =>
    apiRequest('/admin/royalty/commissions', {
      method: 'POST',
      body: JSON.stringify({ period, entries }),
    }),
  setStatus: (id: string, { status, notes }: RoyaltyStatusPayload = {}): Promise<unknown> =>
    apiRequest(`/admin/royalty/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, notes }),
    }),
};

// ─── B2B / Industrial pipeline ────────────────────────────────────────────
export interface MilestoneOptions {
  milestone?: string;
  note?: string;
}

export const b2bAPI = {
  getPipeline: (): Promise<unknown> => apiRequest('/admin/b2b/pipeline'),
  updateMilestone: (
    bookingId: string,
    { milestone, note }: MilestoneOptions = {},
  ): Promise<unknown> =>
    apiRawAdminBody(`/admin/b2b/bookings/${bookingId}/milestone`, { milestone, note }),
  listEnquiries: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/enquiries${qs(params)}`),
  issueQuote: (enquiryId: string, payload: Record<string, unknown>): Promise<unknown> =>
    apiRequest(`/admin/enquiries/${enquiryId}/quote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  rejectEnquiry: (enquiryId: string, { reason }: { reason?: string } = {}): Promise<unknown> =>
    apiRequest(`/admin/enquiries/${enquiryId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  convertToBooking: (enquiryId: string): Promise<unknown> =>
    apiRequest(`/admin/enquiries/${enquiryId}/convert-to-booking`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

// Helper — mirror apiRequest but keep the full response (we want the sibling
// `notification` field alongside the unwrapped data).
const apiRawAdminBody = async (endpoint: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const msg = (parsed && parsed.message) || `API ${response.status} ${response.statusText}`;
    const err: ApiError = new Error(msg);
    err.status = response.status;
    err.body = parsed;
    throw err;
  }
  invalidateCache();
  return parsed;
};

// ─── Secure document vault (B2B corporate docs) ──────────────────────────
export const vaultAPI = {
  listForEnquiry: (enquiryId: string): Promise<unknown> =>
    apiRequest(`/vault/enquiry/${enquiryId}`),
  upload: (formData: FormData): Promise<unknown> =>
    apiRequest('/vault/upload', { method: 'POST', body: formData }),
  downloadUrl: (id: string): string => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'https://flipon-backend.onrender.com/api';
    return `${base}/vault/${id}/download`;
  },
  delete: (id: string): Promise<unknown> => apiRequest(`/vault/${id}`, { method: 'DELETE' }),
};

// ─── In-app inbox (top-down notification banner) ─────────────────────────
export const inboxAPI = {
  // GET unread notifications for the current admin. Drives the top-down
  // banner that pops on dashboard load.
  unread: (): Promise<{ notifications: any[]; unread_count: number }> =>
    apiRequest('/notifications/inbox?unread_only=true&limit=10'),
  // Mark a single notification seen — called when the user taps or
  // dismisses the banner.
  markRead: (id: string | number): Promise<unknown> =>
    apiRequest(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: (): Promise<unknown> =>
    apiRequest('/notifications/read-all', { method: 'POST' }),
};

// ─── Admin management ────────────────────────────────────────────────────
export const adminAPI = {
  getUsers: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/users${qs(params)}`),
  setUserStatus: (id: string, body: Record<string, unknown>): Promise<unknown> =>
    apiRequest(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify(body) }),
  getAdmins: (): Promise<unknown> => apiRequest('/admin/admins'),
  createAdmin: (data: Record<string, unknown>): Promise<unknown> =>
    apiRequest('/admin/admins', { method: 'POST', body: JSON.stringify(data) }),
  updateAdmin: (id: string, data: Record<string, unknown>): Promise<unknown> =>
    apiRequest(`/admin/admins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateAdmin: (id: string): Promise<unknown> =>
    apiRequest(`/admin/admins/${id}`, { method: 'DELETE' }),
  getAuditLogs: (params: Record<string, unknown> = {}): Promise<unknown> =>
    apiRequest(`/admin/audit-logs${qs(params)}`),
  getConfig: (): Promise<unknown> => apiRequest('/admin/config'),
  updateConfig: (patch: Record<string, unknown>): Promise<unknown> =>
    apiRequest('/admin/config', { method: 'PUT', body: JSON.stringify(patch) }),

  // Global Exports — server-side CSV downloads. Each call hits the
  // backend, which streams a CSV via Content-Disposition and writes
  // an audit log row. Browser saves the file to Downloads.
  exportFinancial: (): Promise<void> =>
    downloadFile('/admin/exports/financial', 'flipone-financial-export'),
  exportUsers: (): Promise<void> =>
    downloadFile('/admin/exports/users', 'flipone-users-export'),
  exportAgents: (): Promise<void> =>
    downloadFile('/admin/exports/agents', 'flipone-agents-export'),
};

// Download helper — fetches an endpoint as a Blob and triggers the
// browser's Save-As. Used by Global Exports. Errors propagate so the
// caller can show a toast on failure.
const downloadFile = async (endpoint: string, baseName: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'GET' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Export failed (HTTP ${response.status})`);
  }
  const blob = await response.blob();
  // Try to honour the server-supplied filename in Content-Disposition,
  // else fall back to a stamped local one.
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = match?.[1] || `${baseName}-${stamp}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const healthAPI = {
  check: (): Promise<unknown> =>
    fetch('https://flipon-backend.onrender.com/health').then((r) => r.json()),
};

export default {
  dashboardAPI,
  ordersAPI,
  agentsAPI,
  servicesAPI,
  helpdeskAPI,
  reportsAPI,
  adminAPI,
  healthAPI,
};
