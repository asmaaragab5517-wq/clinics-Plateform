import type { AppointmentStatus, ConsentType, QueuePriority, Role } from '@hf/shared';

/** Response shapes of the endpoints the app uses (see apps/api/src/modules/*.ts). Timestamps are ISO strings. */
export interface Named {
  name_ar: string;
  name_en: string | null;
}

// ---- auth
export interface OtpRequestResponse {
  sent: boolean;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  devCode?: string;
}
export interface OtpVerifyResponse {
  ok: true;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  locale: 'ar' | 'en';
}
export interface StaffMe {
  userId: string;
  orgId: string;
  name: string;
  roles: Role[];
  memberships: { role: Role; clinicId: string | null }[];
  network: boolean;
  clinics: ({ id: string; slug: string } & Named)[];
  privileges: string[];
  authTime: number | null;
}

// ---- public catalogue
export interface Specialty extends Named {
  id: string;
  slug: string;
  doctors: number;
}
export interface DoctorSummary extends Named {
  id: string;
  slug: string;
  title: string | null;
  gender: 'male' | 'female' | null;
  bio_ar: string | null;
  bio_en: string | null;
  rating_avg: string | number | null;
  rating_count: number | null;
  specialties: ({ slug: string } & Named)[];
  clinics: ({ id: string; slug: string; governorate: string; city?: string | null } & Named)[];
  fee: number | null;
  /** First bookable slot in the next 14 days (list endpoint only; ISO). */
  next_available?: string | null;
  /** Relative, public API path (GET /v1/public/doctors/:slug/photo); list endpoint only. */
  photo_url?: string | null;
  /** Internal storage key; the profile endpoint returns it instead of photo_url (README "API gaps"). */
  photo_key?: string | null;
}
export interface DoctorService extends Named {
  id: string;
  code: string;
  duration_minutes: number;
  type: string;
  prices: { clinicId: string; price: number }[] | null;
}
export interface DoctorProfile extends DoctorSummary {
  syndicate_number: string | null;
  qualifications: unknown;
  services: DoctorService[];
  reviews: { rating: number; comment: string | null; display_name: string; created_at: string }[];
  nextAvailable: string | null;
}
export interface Slot {
  start: string;
  end: string;
  date: string;
  localStart: string;
  clinicId: string;
}
export interface PublicClinic extends Named {
  id: string;
  slug: string;
  governorate: string | null;
  city: string | null;
  address_lines: string | null;
}
export interface PublicService extends Named {
  id: string;
  code: string;
  type: string;
  duration_minutes: number;
  clinic_id: string;
  price: number;
}

// ---- portal
export interface PortalPatient {
  id: string;
  mrn: string;
  first_name_ar: string;
  father_name_ar: string;
  family_name_ar: string;
  name_en: string | null;
  date_of_birth: string;
  gender: 'male' | 'female';
  relation: 'self' | 'child' | 'spouse' | 'parent' | 'sibling' | 'other';
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
  payment_mode: 'online' | 'at_clinic' | null;
  hold_expires_at: string | null;
  clinic_name_ar: string;
  clinic_name_en: string | null;
  address_lines: string | null;
  doctor_name_ar: string;
  doctor_name_en: string | null;
  ticket_number: number | null;
  checkout_url: string | null;
  /** Includes a telemedicine service (video visit). Older APIs and cached rows may omit it. */
  is_video?: boolean;
}
export interface BookingResponse {
  appointment: { id: string; ref: string; status: AppointmentStatus; start_at: string; hold_expires_at: string | null };
  payment: { id: string; checkout_url: string; amount: number; status: string } | null;
  holdExpiresAt: string | null;
}
export interface QueuePosition {
  ticketNumber: number;
  status: 'waiting' | 'called' | 'serving' | 'done' | 'skipped';
  position: number | null;
  nowServing: number | null;
}
export interface PortalPrescription {
  id: string;
  patient_id: string;
  issued_at: string;
  doctor_name_ar: string;
  doctor_name_en: string | null;
  lines: { drug: string | null; instructionsAr: string; instructionsEn: string; durationDays: number | null }[] | null;
}
export interface PortalVisit {
  id: string;
  patient_id: string;
  signed_at: string;
  patient_summary: string | null;
  diagnoses: { code: string; primary?: boolean; note?: string }[];
  follow_up: { date: string } | null;
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
/** GET /v1/portal/appointments/:id/telemedicine (telemedicine.ts `status`). */
export interface TelemedicineStatus {
  status: 'scheduled' | 'patient_waiting' | 'in_progress' | 'ended' | 'cancelled';
  opensAt: string;
  closesAt: string;
  canJoin: boolean;
}
export interface TelemedicineLink {
  url: string;
  passcode: string | null;
  provider: string;
}
export type ComplaintCategory = 'waiting_time' | 'staff_behaviour' | 'clinical_care' | 'billing' | 'facility' | 'communication' | 'other';
export interface SignedLink {
  url: string;
  /** API-relative path and the bare token (newer APIs); the app opens `url` in the system browser. */
  path?: string;
  token?: string;
  expiresInSeconds: number;
}

/** GET /v1/portal/coverages (portal.ts): insurance on file for the account's patients. */
export interface PortalCoverage {
  id: string;
  patient_id: string;
  member_number: string;
  /** YYYY-MM-DD */
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  plan_name?: string;
  coverage_percent?: number | string | null;
  /** Fixed co-payment per visit, piastres. */
  copay_fixed?: number | string | null;
  payer_name_ar?: string;
  payer_name_en?: string | null;
  /** Who recorded the cover: clinic staff, or the patient in the app/portal. */
  source?: 'staff' | 'patient';
  /** False until reception verifies the card; unverified cover is not used for billing. Older APIs omit it. */
  verified?: boolean;
  /** pending, verified, withdrawn (by the patient), rejected (by the clinic) or inactive. Older APIs omit it. */
  status?: 'pending' | 'verified' | 'withdrawn' | 'rejected' | 'inactive';
}
/** GET /v1/portal/payers: active insurers with their active plans (names only). */
export interface PortalPayer {
  id: string;
  name_ar: string;
  name_en: string | null;
  plans: { id: string; name: string }[];
}

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** GET /v1/portal/complaints (events.ts): the account's own complaints, newest first (max 100). */
export interface PortalComplaint {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  category: ComplaintCategory;
  description: string;
  status: ComplaintStatus;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
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
export interface PortalNotification {
  id: string;
  patient_id: string | null;
  event: string;
  channel: string;
  body: string;
  status: string;
  created_at: string;
}
export interface NotificationPreferences {
  channels: ('whatsapp' | 'sms' | 'push' | 'email')[];
  marketing_opt_out: boolean;
  sms_opt_out: boolean;
  whatsapp_opt_out: boolean;
}
export interface ConsentsResponse {
  versions: { id: string; type: ConsentType; version: number; text_ar: string; text_en: string; published_at: string }[];
  consents: { patient_id: string; type: ConsentType; granted: boolean; version_id: string; created_at: string; needsReconsent: boolean }[];
}

// ---- staff
export interface StaffAppointment {
  id: string;
  ref: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  channel: string;
  payment_mode: string | null;
  is_walk_in: boolean;
  notes: string | null;
  patient_name: string;
  mrn: string;
  doctor_name: string;
  services: ({ id: string } & Named)[];
  ticket_number: number | null;
  /** Created at check-in; null before (appointments.ts list). */
  encounter_id: string | null;
}
export interface QueueTicket {
  id: string;
  ticket_number: number;
  priority: QueuePriority;
  status: 'waiting' | 'called' | 'serving' | 'done' | 'skipped';
  checked_in_at: string;
  doctor_id: string;
  doctor_name: string;
  patient_name: string | null;
  appointment_id: string;
  patient_id: string;
  encounter_id: string | null;
}
export interface QueueGroup {
  doctorId: string;
  doctorName: string;
  serving: QueueTicket | null;
  called: QueueTicket | null;
  waiting: QueueTicket[];
  done: number;
}
export interface PatientSearchRow {
  id: string;
  mrn: string;
  first_name_ar: string;
  father_name_ar: string;
  grandfather_name_ar: string;
  family_name_ar: string;
  name_en: string | null;
  date_of_birth: string;
  gender: 'male' | 'female';
  phone: string | null;
}
export interface Allergy {
  id?: string;
  text: string;
  severity: 'mild' | 'moderate' | 'severe' | null;
  ingredient: string | null;
}
export interface StaffPatient extends PatientSearchRow {
  allergies: Allergy[];
  contacts: { id: string; phone: string; is_primary: boolean }[];
}
export interface HistoryItem {
  id: string;
  kind: 'allergy' | 'chronic' | 'surgery' | 'medication' | 'family' | 'social' | 'immunisation';
  text: string;
  severity: string | null;
  is_active: boolean;
}
export interface EncounterListRow {
  id: string;
  clinic_id: string;
  clinic_name: string;
  doctor_id: string;
  doctor_name: string;
  status: 'open' | 'signed';
  chief_complaint: string;
  diagnoses: { code: string; primary?: boolean }[];
  created_at: string;
  signed_at: string | null;
}
export interface Vitals {
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  temperatureC?: number;
  respiratoryRate?: number;
  spo2?: number;
  weightKg?: number;
  heightCm?: number;
  glucoseMgDl?: number;
  bmi?: number;
}
export interface Encounter {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  appointment_id: string | null;
  status: 'open' | 'signed';
  vitals: Vitals;
  chief_complaint: string;
  hpi?: string | null;
  examination?: string | null;
  notes: string;
  diagnoses: { code: string; primary: boolean; note?: string }[];
  allergies: Allergy[];
  prescriptions: { id: string; status: string; verify_code: string; issued_at: string | null }[];
  signed_at: string | null;
}
export interface Icd10 {
  code: string;
  title_en: string;
  title_ar: string | null;
}
export interface Drug {
  id: string;
  trade_name_en: string;
  trade_name_ar: string | null;
  active_ingredients: string[];
  strength: string | null;
  form: string | null;
  price: number | null;
}
export interface RxLineInput {
  drugId?: string;
  freeText?: string;
  dose: string;
  route: string;
  frequency: string;
  durationDays?: number;
  instructionsAr: string;
  instructionsEn: string;
  /** display only */
  label?: string;
}
export interface RxTemplate {
  id: string;
  name: string;
  diagnosis_code: string | null;
  lines: RxLineInput[];
}
export interface RxWarning {
  line: number;
  kind: 'allergy' | 'duplicate_ingredient' | 'free_text';
  detail: string;
}
export interface CommissionStatement {
  id: string;
  doctor_id: string;
  clinic_id: string | null;
  month: string;
  revenue: number;
  share: number;
  status: 'draft' | 'approved';
  doctor_name: string;
}

/** GET /v1/doctors (staff.ts): staff directory, now readable by receptionists (schedule:view). */
export interface StaffDoctor extends Named {
  id: string;
  slug: string;
  title: string | null;
  is_public: boolean;
  clinic_ids: string[];
  specialty_ids: string[];
  service_ids: string[];
}
/** GET /v1/services (catalogue.ts). */
export interface StaffService extends Named {
  id: string;
  code: string;
  type: string;
  duration_minutes: number;
  is_active: boolean;
}

// ---- telemedicine (doctor)
export interface DoctorVideoVisit {
  appointment_id: string;
  ref: string;
  start_at: string;
  end_at: string;
  appointment_status: AppointmentStatus;
  doctor_id: string;
  patient_name: string;
  status: TelemedicineStatus['status'] | null;
  patient_joined_at: string | null;
  admitted_at: string | null;
  provider: string | null;
}
export interface TelemedicineStart extends TelemedicineLink {
  encounterId: string | null;
}

// ---- AI scribe (ai.ts, integrations/ai.ts encounterDraftSchema)
export type DraftVitalKey = 'systolic' | 'diastolic' | 'heartRate' | 'temperatureC' | 'respiratoryRate' | 'spo2' | 'weightKg' | 'heightCm';
export interface EncounterDraftOutput {
  chiefComplaint: string;
  hpi: string;
  examination: string;
  notes: string;
  vitals: Record<DraftVitalKey, number | null>;
  diagnoses: { code: string; title: string; stated: boolean }[];
  followUpInDays: number | null;
  missingInformation: string[];
}
export interface AiDraftWarning {
  field: string;
  issue: string;
  value?: unknown;
}
export interface AiDraft {
  id: string;
  kind: 'encounter_note' | 'patient_summary' | 'rx_instructions';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  output: EncounterDraftOutput | Record<string, unknown>;
  warnings: AiDraftWarning[];
  model?: string;
  served_model?: string | null;
  prompt_version?: string;
  encounter_id: string | null;
  created_at?: string;
  decided_at?: string | null;
}
export interface ApproveEncounterDraft {
  chiefComplaint?: string;
  hpi?: string;
  examination?: string;
  notes?: string;
  vitals?: Vitals;
  diagnosisCodes?: string[];
  followUpDate?: string | null;
}

// ---- staff HR and payroll (hr.ts, payroll.ts; self-service "me" routes). Dates are YYYY-MM-DD, times Cairo local.
export type PermissionKind = 'late_arrival' | 'early_leave' | 'during_day';
export type HrRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface WorkPattern {
  /** Weekdays worked, 0 = Sunday … 6 = Saturday. */
  days: number[];
  start: string;
  end: string;
  /** Optional unpaid break inside the day (split shift): both or neither. */
  breakStart?: string;
  breakEnd?: string;
}
/** One clock-in/out pair (ISO times); only the day's last pair may be open. */
export interface Punch {
  in: string;
  out: string | null;
}
export interface HrContract {
  id: string;
  clinic_id: string;
  job_title_ar: string;
  job_title_en: string;
  employment_type: 'full_time' | 'part_time' | 'contractor';
  pay_basis: 'monthly' | 'hourly' | 'commission_only';
  start_date: string;
  end_date: string | null;
  work_pattern: WorkPattern;
  status: string;
}
export interface AttendanceRecord {
  id: string;
  work_date: string;
  /** Present on month rows (to_char of work_date). */
  day?: string;
  /** First arrival and last departure (null while a pair is open). */
  clock_in: string | null;
  clock_out: string | null;
  /** Every clock-in/out pair of the day (up to 6); older responses have only clock_in/clock_out. */
  punches?: Punch[] | null;
  source: 'console' | 'mobile' | 'manual' | 'system';
  status: 'open' | 'complete' | 'incomplete' | 'absent' | 'on_leave' | 'holiday' | 'rest_day';
  late_minutes: number;
  early_leave_minutes: number;
  worked_minutes: number;
  overtime_minutes: number;
  /** Part of overtime_minutes inside the night window (paid at the night multiplier). */
  overtime_night_minutes?: number;
  rest_day: boolean;
  overtime_approved: boolean;
  /** Explicit overtime decision (Sprint 20); rejected overtime is not paid. */
  overtime_status?: 'pending' | 'approved' | 'rejected';
  overtime_decided_at?: string | null;
  /** Clock-in/out location verdicts; null when the clinic does not check location. */
  clock_in_check?: LocationCheck | null;
  clock_in_check_detail?: LocationCheckDetail | null;
  clock_out_check?: LocationCheck | null;
  clock_out_check_detail?: LocationCheckDetail | null;
}
export type LocationCheck = 'ok' | 'outside' | 'unverified';
export interface LocationCheckDetail {
  method?: 'network' | 'gps' | 'none' | 'gps_unavailable';
  distance?: number;
  accuracy?: number;
}
export interface AnnualBalance {
  year: number;
  entitled: number;
  carried: number;
  adjusted: number;
  used: number;
  pending: number;
  available: number;
}
export interface LeaveRequest extends Named {
  id: string;
  leave_type_id: string;
  code: string;
  start_date: string;
  end_date: string;
  days: number | string;
  reason: string | null;
  status: HrRequestStatus;
  decision_note: string | null;
  created_at: string;
}
export interface PermissionRequest {
  id: string;
  work_date: string;
  kind: PermissionKind;
  /** HH:MM:SS from /me routes; month rows also carry `start` / `end` as HH:MM. */
  start_time: string;
  end_time: string;
  minutes: number;
  reason: string | null;
  status: HrRequestStatus;
  decision_note: string | null;
  created_at: string;
}
export interface HrMe {
  contract: HrContract | null;
  today: AttendanceRecord | null;
  /** The shift still open: today's, or yesterday's when it crossed midnight (clock-in under 16 hours ago). */
  openRecord?: AttendanceRecord | null;
  /** This month's hourly-permission allowance and what is used (pending and approved). */
  permissionAllowance?: { perMonth: number; minutesPerMonth: number; used: number; usedMinutes: number };
  annualBalance: AnnualBalance | null;
  pending: { leave: LeaveRequest[]; permissions: PermissionRequest[] };
  /** What the clinic checks at clocking: `usesPosition` means the app should send the phone's position. */
  clockCheck?: { mode: 'off' | 'flag' | 'block'; usesPosition: boolean; usesNetwork: boolean } | null;
}
export interface MonthSummary {
  periodDays: number;
  employedDays: number;
  scheduledDays: number;
  workedDays: number;
  workedMinutes: number;
  absentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  latenessMinutes: number;
  overtimeMinutes: number;
  /** Part of overtimeMinutes worked in the night window. */
  nightOvertimeMinutes?: number;
  restDayOvertimeMinutes: number;
  pendingOvertimeMinutes: number;
  futureDays: number;
}
export interface HrMonth {
  month: string;
  contract: HrContract | null;
  summary: MonthSummary | null;
  days: (AttendanceRecord & { day: string })[];
  leave: (Named & { id: string; start_date: string; end_date: string; days: number | string; status: HrRequestStatus; code: string })[];
  permissions: (PermissionRequest & { day: string; start: string; end: string })[];
  holidays: (Named & { day: string })[];
}
export interface LeaveType extends Named {
  id: string;
  code: string;
  paid: boolean;
  uses_annual_balance: boolean;
  annual_quota: number | string | null;
  max_consecutive_days: number | string | null;
  is_active: boolean;
}
/** GET /v1/hr/leave-preview: nulls where the leave type has no balance, quota or consecutive-day limit. */
export interface LeavePreview {
  days: number;
  available: number | null;
  remainingAfter: number | null;
  quota: number | null;
  quotaRemainingAfter: number | null;
  maxConsecutiveDays: number | null;
}
export interface HrBalances {
  year: number;
  annual: AnnualBalance;
  types: (Named & { id: string; code: string; paid: boolean; uses_annual_balance: boolean; annual_quota: number | string | null; used: number })[];
}
export interface MyRequests {
  leave: LeaveRequest[];
  permissions: PermissionRequest[];
}
export interface PayslipLine {
  code: string;
  labelAr: string;
  labelEn: string;
  /** Positive piastres; `kind` says whether it adds to or reduces pay (employer lines are for information). */
  amount: number;
  kind: 'earning' | 'deduction' | 'employer';
  /** e.g. "3 d", "125 min", "4.5 h", "11%", "12/30", or a free-text note (adjustments). */
  basis?: string;
  /** The same quantity as data (Sprint 21); absent for free-text notes and older payslips. */
  quantity?: { value: number; unit: 'minutes' | 'days' | 'hours' | 'percent' | 'days_of'; of?: number };
}
export interface MyPayslip {
  id: string;
  month: string;
  status: 'approved' | 'paid';
  gross: number;
  deductions: number;
  net: number;
  lines: PayslipLine[];
}
