// UI-level RBAC — mirrors the PDF spec "Admin Roles & Permissions" and the
// backend's flipon-backend/src/constants/permissions.js. The backend is the
// real enforcer; this file only decides what to show / hide in the admin panel
// so each role only sees what they're supposed to operate.

// Capability keys. Add sparingly — every new key has to be gated in both the
// frontend and (ideally) the backend permission map.
export const CAP = {
  // Sections (sidebar menu items)
  SECTION_DASHBOARD: 'section.dashboard',
  SECTION_ORDERS: 'section.orders',
  SECTION_AGENTS: 'section.agents',
  SECTION_SERVICES: 'section.services',
  SECTION_HELPDESK: 'section.helpdesk',
  SECTION_REPORTS: 'section.reports',
  SECTION_B2B: 'section.b2b',
  SECTION_VAULT: 'section.vault',
  SECTION_ACCOUNTS: 'section.accounts',
  SECTION_ADMIN: 'section.admin',

  // Order management
  ORDER_VIEW: 'order.view',
  ORDER_VERIFY: 'order.verify',
  ORDER_ASSIGN: 'order.assign',
  ORDER_RESCHEDULE: 'order.reschedule',
  ORDER_CANCEL: 'order.cancel',
  DOCUMENT_VERIFY: 'document.verify',

  // Agents
  AGENT_VIEW: 'agent.view',
  AGENT_MONITOR: 'agent.monitor',
  AGENT_APPROVE: 'agent.approve',
  AGENT_KYC: 'agent.kyc',

  // Services
  SERVICE_VIEW: 'service.view',
  SERVICE_EDIT: 'service.edit',
  SERVICE_DELETE: 'service.delete',

  // Helpdesk
  TICKET_VIEW: 'ticket.view',
  TICKET_CREATE: 'ticket.create',
  TICKET_UPDATE: 'ticket.update',
  CUSTOMER_VIEW: 'customer.view',

  // Reports
  REPORT_OPERATIONAL: 'report.operational',
  REPORT_AGENTS: 'report.agents',
  REPORT_REVENUE: 'report.revenue',
  REPORT_SERVICE_DEMAND: 'report.service_demand',
  REPORT_PENDING_DOCS: 'report.pending_docs',

  // Admin management
  ADMIN_USER_MANAGE: 'admin.user_manage',
  AUDIT_LOGS_VIEW: 'admin.audit_view',

  // B2B pipeline + vault
  B2B_PIPELINE_VIEW: 'b2b.pipeline.view',
  B2B_PIPELINE_UPDATE: 'b2b.pipeline.update',
  VAULT_VIEW: 'vault.view',
  VAULT_UPLOAD: 'vault.upload',
  VAULT_DELETE: 'vault.delete',

  // Finance / Accounts
  PAYOUT_VIEW: 'finance.payout.view',
  PAYOUT_CREATE: 'finance.payout.create',
  PAYOUT_APPROVE: 'finance.payout.approve',
  ROYALTY_VIEW: 'finance.royalty.view',
  ROYALTY_APPROVE: 'finance.royalty.approve',

  // Scope filters
  SCOPE_B2B_ONLY: 'scope.b2b_only',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];
export type Role = 'super_admin' | 'operations_manager' | 'b2b_admin' | 'finance_admin' | 'customer_support';

interface RoleSpec {
  label: string;
  target: string;
  caps: Array<Capability | '*'>;
}

// PDF-exact role → capability map.
// Super Admin gets everything (wildcard). Every other role is restricted.
const ROLES: Record<Role, RoleSpec> = {
  super_admin: {
    label: 'Super Admin',
    target: 'Owner / Founder',
    caps: ['*'],
  },

  operations_manager: {
    label: 'Operations Manager',
    target: 'Office Manager / Operations Head',
    caps: [
      CAP.SECTION_DASHBOARD,
      CAP.SECTION_ORDERS,
      CAP.SECTION_AGENTS,
      CAP.SECTION_HELPDESK,
      CAP.SECTION_REPORTS,
      CAP.ORDER_VIEW, CAP.ORDER_VERIFY, CAP.ORDER_ASSIGN, CAP.ORDER_RESCHEDULE, CAP.ORDER_CANCEL,
      CAP.DOCUMENT_VERIFY,
      CAP.AGENT_VIEW, CAP.AGENT_MONITOR,
      CAP.SERVICE_VIEW,
      CAP.TICKET_VIEW, CAP.TICKET_CREATE, CAP.TICKET_UPDATE, CAP.CUSTOMER_VIEW,
      CAP.REPORT_OPERATIONAL, CAP.REPORT_AGENTS, CAP.REPORT_PENDING_DOCS,
    ],
  },

  b2b_admin: {
    label: 'B2B / Industrial Admin',
    target: 'Industrial Liaisoning Expert',
    caps: [
      CAP.SECTION_DASHBOARD,
      CAP.SECTION_ORDERS,
      CAP.SECTION_REPORTS,
      CAP.SECTION_B2B,
      CAP.SECTION_VAULT,
      CAP.ORDER_VIEW,
      CAP.SERVICE_VIEW,
      CAP.REPORT_SERVICE_DEMAND, CAP.REPORT_PENDING_DOCS,
      CAP.REPORT_REVENUE,
      CAP.B2B_PIPELINE_VIEW, CAP.B2B_PIPELINE_UPDATE,
      CAP.VAULT_VIEW, CAP.VAULT_UPLOAD, CAP.VAULT_DELETE,
      CAP.SCOPE_B2B_ONLY,
    ],
  },

  finance_admin: {
    label: 'Finance & Accounts Admin',
    target: 'Accountant / CA',
    caps: [
      CAP.SECTION_DASHBOARD,
      CAP.SECTION_REPORTS,
      CAP.SECTION_ACCOUNTS,
      CAP.ORDER_VIEW,
      CAP.AGENT_VIEW,
      CAP.SERVICE_VIEW,
      CAP.REPORT_OPERATIONAL,
      CAP.REPORT_REVENUE,
      CAP.PAYOUT_VIEW, CAP.PAYOUT_CREATE, CAP.PAYOUT_APPROVE,
      CAP.ROYALTY_VIEW, CAP.ROYALTY_APPROVE,
    ],
  },

  customer_support: {
    label: 'Customer Support Admin',
    target: 'Customer Care Team',
    caps: [
      CAP.SECTION_DASHBOARD,
      CAP.SECTION_HELPDESK,
      CAP.ORDER_VIEW,
      CAP.AGENT_VIEW,
      CAP.SERVICE_VIEW,
      CAP.TICKET_VIEW, CAP.TICKET_CREATE, CAP.TICKET_UPDATE, CAP.CUSTOMER_VIEW,
    ],
  },
};

export const ROLE_LIST: Role[] = Object.keys(ROLES) as Role[];

export const roleMeta = (role: string): RoleSpec =>
  ROLES[role as Role] || { label: role, target: '', caps: [] };

// Primary gate. Pass it a capability key — returns boolean.
export const can = (role: string, capability: Capability | undefined): boolean => {
  const spec = ROLES[role as Role];
  if (!spec || !capability) return false;
  if (spec.caps.includes('*')) return true;
  return spec.caps.includes(capability);
};

export const canAny = (role: string, ...caps: Capability[]): boolean =>
  caps.some((c) => can(role, c));

// Returns the first section the role is allowed into, for redirecting away
// from a forbidden tab after a role switch.
export const firstAllowedSection = (role: string): string => {
  const order: Capability[] = [
    CAP.SECTION_DASHBOARD,
    CAP.SECTION_B2B,
    CAP.SECTION_VAULT,
    CAP.SECTION_ACCOUNTS,
    CAP.SECTION_HELPDESK,
    CAP.SECTION_ORDERS,
    CAP.SECTION_AGENTS,
    CAP.SECTION_REPORTS,
    CAP.SECTION_SERVICES,
    CAP.SECTION_ADMIN,
  ];
  const match = order.find((c) => can(role, c));
  return match ? match.replace('section.', '') : 'dashboard';
};
