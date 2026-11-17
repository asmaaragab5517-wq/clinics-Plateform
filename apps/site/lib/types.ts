import type { AppointmentStatus } from '@hf/shared';

/** Response shapes of apps/api (see apps/api/src/modules/{public,portal,prescriptions}.ts). pg numerics may arrive as strings. */
export type Num = number | string | null;

export interface Named {
  name_ar: string;
  name_en: string | null;
}

export interface SpecialtyRef extends Named {
  id?: string;
  slug: string;
}

export interface Specialty extends SpecialtyRef {
  id: string;
  doctors?: number;
}

export interface WorkingHours {
  weekday: number;
  open: string;
  close: string;
}

export interface Clinic extends Named {
  id: string;
  slug: string;
  governorate: string;
  city: string | null;
  address_lines: string | null;
  lat: Num;
  lng: Num;
  phones: string[] | null;
  email?: string | null;
  working_hours: WorkingHours[] | null;
  specialties?: SpecialtyRef[];
}

export interface ClinicDetail extends Clinic {
  doctors: Doctor[];
  rating: { avg: Num; count: number };
}

export interface DoctorClinicRef extends Named {
  id: string;
  slug: string;
  governorate: string;
  city?: string | null;
}

export interface Doctor extends Named {
  id: string;
  slug: string;
  title: string | null;
  gender: 'male' | 'female' | null;
  languages: string[] | null;
  bio_ar: string | null;
  bio_en: string | null;
  photo_key: string | null;
  rating_avg: Num;
  rating_count: number | null;
  specialties: SpecialtyRef[];
  clinics: DoctorClinicRef[];
  fee: Num;
  /** Listing only: first free online slot in the next 14 days (ISO). */
  next_available?: string | null;
  /** Listing only: API-relative photo path; the site serves it from /api/public/doctors/:slug/photo. */
  photo_url?: string | null;
}

export interface DoctorService extends Named {
  id: string;
  code: string;
  duration_minutes: number;
  type: string;
  prices: { clinicId: string | null; price: number }[] | null;
}

export interface Review {
  rating: number;
  comment: string | null;
  display_name: string;
  created_at: string;
}

export interface DoctorDetail extends Doctor {
  syndicate_number: string | null;
  qualifications: { degree?: string; institution?: string; year?: number }[] | null;
  services: DoctorService[];
  reviews: Review[];
  nextAvailable: string | null;
}

export interface PriceRow extends Named {
  id: string;
  code: string;
  type: string;
  duration_minutes: number;
  vat: 'taxable' | 'exempt' | 'zero';
  clinic_id: string | null;
  price: number;
}

export interface PublicPackage extends Named {
  id: string;
  sessions: number;
  validity_days: number;
  price: number;
}

export interface Slot {
  start: string;
  end: string;
  date: string;
  localStart: string;
  clinicId: string;
}

export interface ArticleSummary {
  id: string;
  kind: 'article' | 'news' | 'page';
  slug: string;
  title_ar: string;
  title_en: string | null;
  excerpt_ar: string | null;
  excerpt_en: string | null;
  published_at: string | null;
}

export interface Article extends ArticleSummary {
  body_ar: string;
  body_en: string | null;
  updated_at: string | null;
}

export interface PublicOrg extends Named {
  id: string;
  slug: string;
  branding: Record<string, unknown> | null;
  /** Effective booking policy (defaults merged with the organisation's overrides). */
  booking: { requireOnlinePayment?: boolean; holdMinutes?: number; cancellationCutoffHours?: number; leadMinutes?: number; maxReschedules?: number; depositPercent?: number } | null;
  digit_style: string | null;
}

export interface RxVerification {
  valid: boolean;
  issuedAt?: string;
  doctor?: string;
  clinic?: string;
}

// ---- Portal

export interface PortalPatient {
  id: string;
  mrn: string;
  first_name_ar: string;
  father_name_ar: string | null;
  family_name_ar: string | null;
  name_en: string | null;
  date_of_birth: string;
  gender: 'male' | 'female';
  relation: string;
  confirmed_at: string | null;
}

export interface PortalMe {
  account: { id: string; phone: string; locale: 'ar' | 'en'; status: string; created_at: string };
  patients: PortalPatient[];
}

export interface PortalAppointment {
  id: string;
  ref: string;
  patient_id: string;
  clinic_id: string;
  doctor_id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  payment_mode: string;
  hold_expires_at: string | null;
  clinic_name_ar: string;
  clinic_name_en: string | null;
  address_lines: string | null;
  doctor_name_ar: string;
  doctor_name_en: string | null;
  ticket_number: number | null;
  checkout_url: string | null;
}

export interface QueueInfo {
  ticketNumber: number;
  status: string;
  position: number | null;
  nowServing: number | null;
}

export interface BookingResult {
  appointment: { id: string; ref: string; status: AppointmentStatus; start_at: string; end_at: string; hold_expires_at: string | null };
  payment: { id: string; checkout_url: string; amount: number; status: string } | null;
  holdExpiresAt: string | null;
}

export interface PortalPrescription {
  id: string;
  patient_id: string;
  issued_at: string;
  doctor_name_ar: string;
  doctor_name_en: string | null;
  lines: { drug: string | null; instructionsAr: string | null; instructionsEn: string | null; durationDays: number | null }[] | null;
}

export interface PortalVisit {
  id: string;
  patient_id: string;
  signed_at: string;
  patient_summary: string | null;
  diagnoses: unknown;
  follow_up: unknown;
  doctor_name_ar: string;
  clinic_name_ar: string;
}

export interface PortalDocument {
  id: string;
  patient_id: string;
  title: string;
  kind: string;
  mime: string;
  size_bytes: number;
  patient_provided: boolean;
  created_at: string;
}

export interface PortalInvoice {
  id: string;
  patient_id: string;
  number: string;
  status: string;
  total: number;
  paid: number;
  refunded: number;
  credited: number;
  issued_at: string;
  clinic_name_ar: string;
}

export interface PortalPackage {
  id: string;
  patient_id: string;
  sessions_total: number;
  sessions_used: number;
  expires_on: string;
  name_ar: string;
  name_en: string | null;
}

export interface PortalMessage {
  id: string;
  patient_id: string | null;
  event: string;
  channel: string;
  body: string;
  status: string;
  created_at: string;
}

export interface Preferences {
  channels: string[];
  marketing_opt_out: boolean;
  sms_opt_out: boolean;
  whatsapp_opt_out: boolean;
}

export interface ConsentVersion {
  id: string;
  type: string;
  version: number;
  text_ar: string;
  text_en: string | null;
  published_at: string;
}

export interface ConsentState {
  patient_id: string;
  type: string;
  granted: boolean;
  version_id: string;
  created_at: string;
  needsReconsent: boolean;
}

export interface ShareLink {
  url: string;
  /** API-relative path (`/v1/share/<kind>/<token>`); newer APIs only. */
  path?: string;
  /** The signed token itself; newer APIs only. */
  token?: string;
  expiresInSeconds: number;
}

/** GET /v1/portal/appointments/:id/telemedicine (FR-TEL-4). */
export interface TelemedicineStatus {
  status: string;
  opensAt: string;
  closesAt: string;
  canJoin: boolean;
}

export interface TelemedicineJoin {
  url: string;
  passcode: string | null;
  provider: string;
}

export const COMPLAINT_CATEGORIES = ['waiting_time', 'staff_behaviour', 'clinical_care', 'billing', 'facility', 'communication', 'other'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/** GET /v1/portal/coverages: the account's patients' insurance (plan and payer names joined server-side). */
export interface PortalCoverage {
  id: string;
  patient_id: string;
  member_number: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  plan_name?: string;
  coverage_percent?: Num;
  /** Fixed co-payment per visit, piastres. */
  copay_fixed?: Num;
  payer_name_ar?: string;
  payer_name_en?: string | null;
}

export const COMPLAINT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** GET /v1/portal/complaints: the account's own complaints, newest first. */
export interface PortalComplaint {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  category: ComplaintCategory | string;
  description: string;
  status: ComplaintStatus | string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}
