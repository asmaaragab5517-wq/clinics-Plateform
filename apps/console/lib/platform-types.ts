/** Shapes returned by the API's `/v1/platform/*` routes (see packages/db/migrations/0018_platform.sql). */

export interface PlatformOrg {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  status: 'active' | 'suspended' | string;
  created_at: string;
  plan_code: string | null;
  sub_status: 'trial' | 'active' | 'past_due' | 'cancelled' | null;
  period_end: string | null;
  clinics: number;
  staff: number;
  patients: number;
  appointments_30d: number;
  sms_segments_30d: number;
  sms_cost_30d: number;
  storage_bytes: number | string;
}

export interface PlatformPlan {
  code: string;
  name_ar: string;
  name_en: string;
  monthly_price: number;
  limits: { clinics?: number; staff?: number; smsPerMonth?: number; smsOveragePrice?: number; storageGb?: number };
  is_active: boolean;
}

export interface PlatformInvoice {
  id: string;
  organisation_id: string;
  period_start: string;
  period_end: string;
  plan_code: string;
  amount: number;
  usage: { smsSegments?: number; smsOverage?: number };
  status: 'open' | 'paid' | 'void';
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface PlatformSupportAccess {
  id: string;
  organisation_id: string;
  admin_id: string;
  reason: string;
  hours: number;
  status: 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired';
  decided_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}
