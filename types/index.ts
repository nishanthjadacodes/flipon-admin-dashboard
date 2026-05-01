// Shared API/domain types for the admin Next.js dashboard.
// Mirror of customerandroidapp/src/types/api.ts so the two stay in lockstep.

export type Id = string;
export type ISODate = string;

export type UserRole = 'customer' | 'agent' | 'partner' | 'super_admin' | 'operations_manager';

export interface User {
  id: Id;
  name?: string;
  mobile?: string;
  email?: string;
  role?: UserRole;
  rating?: number;
  total_jobs_completed?: number;
  is_active?: boolean;
  created_at?: ISODate;
}

export type BookingStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'documents_collected'
  | 'submitted'
  | 'completed'
  | 'cancelled';

export interface Booking {
  id: Id;
  booking_number?: number;
  customer_id: Id;
  agent_id?: Id | null;
  service_id: Id;
  status: BookingStatus;
  customer_name: string;
  customer_mobile: string;
  service_address?: string | Record<string, unknown>;
  preferred_date?: string;
  preferred_time?: string;
  price_quoted?: number;
  created_at?: ISODate;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
