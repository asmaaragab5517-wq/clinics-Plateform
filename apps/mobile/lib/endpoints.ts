import { api, request } from './api';
import { randomId } from './random';
import type {
  AiDraft,
  ApproveEncounterDraft,
  BookingResponse,
  ComplaintCategory,
  DoctorVideoVisit,
  AttendanceRecord,
  HrBalances,
  HrMe,
  HrMonth,
  LeavePreview,
  LeaveRequest,
  LeaveType,
  MyPayslip,
  MyRequests,
  PermissionKind,
  PermissionRequest,
  CommissionStatement,
  ConsentsResponse,
  DoctorProfile,
  DoctorSummary,
  Drug,
  Encounter,
  EncounterListRow,
  HistoryItem,
  Icd10,
  NotificationPreferences,
  OtpRequestResponse,
  OtpVerifyResponse,
  PatientSearchRow,
  PortalAppointment,
  PortalComplaint,
  PortalCoverage,
  PortalDocument,
  PortalInvoice,
  PortalMe,
  PortalNotification,
  PortalPackage,
  PortalPayer,
  PortalPrescription,
  PortalVisit,
  PublicClinic,
  PublicService,
  QueueGroup,
  QueuePosition,
  RxLineInput,
  RxTemplate,
  RxWarning,
  SignedLink,
  Slot,
  Specialty,
  StaffAppointment,
  StaffDoctor,
  StaffMe,
  StaffPatient,
  StaffService,
  TelemedicineLink,
  TelemedicineStart,
  TelemedicineStatus,
  Vitals,
} from './types';
import type { ConsentType, QueuePriority } from '@hf/shared';

/** Typed helpers, one per API route used by the app. Route sources: apps/api/src/modules/*.ts. */
export const authApi = {
  requestOtp: (phone: string, purpose: 'login' | 'link_family' = 'login') => api.post<OtpRequestResponse>('/v1/auth/otp/request', { phone, purpose }),
  verifyOtp: (phone: string, code: string, deviceId: string) => api.post<OtpVerifyResponse>('/v1/auth/otp/verify', { phone, code, deviceId }),
  /** With this device's refresh token only its token family is revoked (auth.ts `logout`); other devices stay signed in. */
  logout: (refreshToken: string) => api.post<{ ok: true }>('/v1/auth/logout', { refreshToken }, 'patient'),
  staffMe: () => api.get<StaffMe>('/v1/auth/me', undefined, 'staff'),
};

export const publicApi = {
  specialties: () => api.get<Specialty[]>('/v1/public/specialties'),
  /** `availableBy` (YYYY-MM-DD) keeps doctors with a free slot up to that day, sorted by next_available. */
  doctors: (f: { specialty?: string; q?: string; clinicId?: string; city?: string; availableBy?: string }) => api.get<DoctorSummary[]>('/v1/public/doctors', f),
  clinics: () => api.get<PublicClinic[]>('/v1/public/clinics'),
  doctor: (slug: string) => api.get<DoctorProfile>(`/v1/public/doctors/${encodeURIComponent(slug)}`),
  slots: (q: { doctorId: string; clinicId?: string; serviceId?: string; from?: string; days?: number }) => api.get<Slot[]>('/v1/public/slots', { days: 14, ...q }),
  services: (clinicId?: string) => api.get<PublicService[]>('/v1/public/services', { clinicId }),
};

export const portalApi = {
  me: () => api.get<PortalMe>('/v1/portal/me', undefined, 'patient'),
  setLocale: (locale: 'ar' | 'en') => api.patch<{ id: string; locale: string }>('/v1/portal/me', { locale }, 'patient'),
  addPatient: (body: {
    patient: { nameAr: { first: string; father: string; grandfather: string; family: string }; nameEn?: string; dateOfBirth: string; gender: 'male' | 'female'; phones: { number: string; primary: boolean }[] };
    relation: 'self' | 'child' | 'spouse' | 'parent' | 'sibling' | 'other';
    consentHealthData: true;
    consentMessaging: boolean;
  }) => api.post<{ id: string }>('/v1/portal/patients', body, 'patient'),
  /** FR-PAT-4: confirm family links created at reception with an OTP (purpose link_family) sent to this phone. */
  confirmLinks: (code: string) => api.post<{ linked: string[] }>('/v1/portal/links/confirm', { code }, 'patient'),
  appointments: (scope: 'upcoming' | 'past') => api.get<PortalAppointment[]>('/v1/portal/appointments', { scope }, 'patient'),
  appointment: (id: string) => api.get<PortalAppointment>(`/v1/portal/appointments/${id}`, undefined, 'patient'),
  /** 400 not_a_video_consultation for in-clinic visits (telemedicine.ts). */
  telemedicine: (id: string) => api.get<TelemedicineStatus>(`/v1/portal/appointments/${id}/telemedicine`, undefined, 'patient'),
  joinTelemedicine: (id: string) => api.post<TelemedicineLink>(`/v1/portal/appointments/${id}/telemedicine/join`, {}, 'patient'),
  /** Idempotency-Key: create one per booking attempt (newIdempotencyKey) and reuse it on retry. */
  book: (body: { clinicId: string; doctorId: string; serviceId: string; start: string; patientId: string; paymentMode: 'online' | 'at_clinic' }, idempotencyKey: string) =>
    request<BookingResponse>('/v1/portal/bookings', { method: 'POST', body, auth: 'patient', idempotencyKey }),
  cancel: (id: string, reason: string) => api.post(`/v1/portal/appointments/${id}/cancel`, { reason }, 'patient'),
  reschedule: (id: string, start: string) => api.post(`/v1/portal/appointments/${id}/reschedule`, { start }, 'patient'),
  confirm: (id: string) => api.post(`/v1/portal/appointments/${id}/confirm`, {}, 'patient'),
  queue: (id: string) => api.get<QueuePosition>(`/v1/portal/appointments/${id}/queue`, undefined, 'patient'),
  prescriptions: () => api.get<PortalPrescription[]>('/v1/portal/prescriptions', undefined, 'patient'),
  visits: () => api.get<PortalVisit[]>('/v1/portal/visits', undefined, 'patient'),
  documents: () => api.get<PortalDocument[]>('/v1/portal/documents', undefined, 'patient'),
  documentUrl: (id: string) => api.get<{ url: string; expiresInSeconds: number }>(`/v1/portal/documents/${id}/url`, undefined, 'patient'),
  /** 10-minute signed URLs that the system browser can open without a bearer header (portal.ts). */
  prescriptionLink: (id: string) => api.get<SignedLink>(`/v1/portal/prescriptions/${id}/link`, undefined, 'patient'),
  invoiceLink: (id: string) => api.get<SignedLink>(`/v1/portal/invoices/${id}/link`, undefined, 'patient'),
  invoices: () => api.get<PortalInvoice[]>('/v1/portal/invoices', undefined, 'patient'),
  complaint: (b: { clinicId: string; patientId: string; category: ComplaintCategory; description: string }) =>
    api.post<{ id: string; created_at: string }>('/v1/portal/complaints', { ...b, channel: 'app' }, 'patient'),
  /** The account's own complaints with status and the clinic's resolution (events.ts `myComplaints`). */
  complaints: () => api.get<PortalComplaint[]>('/v1/portal/complaints', undefined, 'patient'),
  /** Insurance on file: member number, plan, payer names and coverage % (portal.ts `coverages`). */
  coverages: () => api.get<PortalCoverage[]>('/v1/portal/coverages', undefined, 'patient'),
  /** Active insurers and their plans, for adding cover (portal.ts `payers`). */
  payers: () => api.get<PortalPayer[]>('/v1/portal/payers', undefined, 'patient'),
  /**
   * Patient-submitted cover, stored unverified until reception checks the card (portal.ts `addCoverage`).
   * 403 patient not on the account, 404 unknown/inactive plan, 400 invalid_dates / too_many_pending_coverages (max 3).
   */
  addCoverage: (b: { patientId: string; planId: string; memberNumber: string; validFrom: string; validTo?: string }) =>
    api.post<{ id: string; verified: false }>('/v1/portal/coverages', b, 'patient'),
  /** Withdraw the account's own unverified submission; 404 once verified. */
  withdrawCoverage: (id: string) => api.post<{ ok: true }>(`/v1/portal/coverages/${id}/withdraw`, {}, 'patient'),
  packages: () => api.get<PortalPackage[]>('/v1/portal/packages', undefined, 'patient'),
  review: (appointmentId: string, rating: number, comment?: string) => api.post('/v1/portal/reviews', { appointmentId, rating, comment: comment || undefined }, 'patient'),
  notifications: () => api.get<PortalNotification[]>('/v1/portal/notifications', undefined, 'patient'),
  preferences: (patientId: string) => api.get<NotificationPreferences>(`/v1/portal/preferences/${patientId}`, undefined, 'patient'),
  setPreferences: (patientId: string, p: { channels: NotificationPreferences['channels']; marketingOptOut: boolean; smsOptOut: boolean; whatsappOptOut: boolean }) =>
    api.patch<NotificationPreferences>(`/v1/portal/preferences/${patientId}`, p, 'patient'),
  consents: () => api.get<ConsentsResponse>('/v1/portal/consents', undefined, 'patient'),
  giveConsent: (b: { patientId: string; type: ConsentType; granted: boolean; versionId: string }) => api.post('/v1/portal/consents', b, 'patient'),
  deleteAccount: () => api.post<{ ok: true }>('/v1/portal/account/delete', {}, 'patient'),
  registerDevice: (token: string, platform: 'ios' | 'android' | 'web') => api.post<{ id: string }>('/v1/portal/devices', { token, platform }, 'patient'),
  unregisterDevice: (token: string) => api.post<{ ok: true }>('/v1/portal/devices/unregister', { token }, 'patient'),
};

export const staffApi = {
  appointments: (q: { clinicId?: string; doctorId?: string; patientId?: string; from: string; to: string; status?: string; ref?: string }) => api.get<StaffAppointment[]>('/v1/appointments', q, 'staff'),
  doctors: (clinicId?: string) => api.get<StaffDoctor[]>('/v1/doctors', { clinicId }, 'staff'),
  services: () => api.get<StaffService[]>('/v1/services', undefined, 'staff'),
  queue: (clinicId: string, doctorId?: string) => api.get<QueueGroup[]>('/v1/queue', { clinicId, doctorId }, 'staff'),
  callNext: (clinicId: string, doctorId: string) => api.post<{ called: { id: string; ticketNumber: number; appointmentId: string } }>('/v1/queue/call-next', { clinicId, doctorId }, 'staff'),
  updateTicket: (id: string, b: { priority?: QueuePriority; status?: 'waiting' | 'skipped' }) => api.patch<{ ok: true }>(`/v1/queue/${id}`, b, 'staff'),
  transition: (id: string, to: 'confirmed' | 'checked_in' | 'in_consultation' | 'completed' | 'no_show' | 'cancelled', reason?: string) =>
    api.post(`/v1/appointments/${id}/transition`, { to, reason }, 'staff'),
  checkIn: (id: string, priority?: QueuePriority) => api.post<{ ticket: { ticket_number: number } | null; packages: unknown[] }>(`/v1/appointments/${id}/check-in`, priority ? { priority } : {}, 'staff'),
  /** Idempotency-Key: one per walk-in attempt, reused on retry so a timeout cannot create a second ticket. */
  walkIn: (b: { patientId: string; clinicId: string; doctorId: string; serviceIds: string[]; priority: QueuePriority }, idempotencyKey: string) =>
    request<{ ticket: { ticket_number: number } | null; replayed?: boolean }>('/v1/appointments/walk-in', { method: 'POST', body: b, auth: 'staff', idempotencyKey }),
  searchPatients: (q: string) => api.get<PatientSearchRow[]>('/v1/patients', { q }, 'staff'),
  patient: (id: string) => api.get<StaffPatient>(`/v1/patients/${id}`, undefined, 'staff'),
  history: (id: string) => api.get<HistoryItem[]>(`/v1/patients/${id}/history`, undefined, 'staff'),
  encounters: (patientId: string) => api.get<EncounterListRow[]>(`/v1/patients/${patientId}/encounters`, undefined, 'staff'),
  encounter: (id: string) => api.get<Encounter>(`/v1/encounters/${id}`, undefined, 'staff'),
  updateEncounter: (id: string, b: { vitals?: Vitals; chiefComplaint?: string; hpi?: string; examination?: string; notes?: string; diagnoses?: { code: string; primary: boolean }[] }) =>
    api.patch<Encounter>(`/v1/encounters/${id}`, b, 'staff'),
  signEncounter: (id: string) => api.post<Encounter>(`/v1/encounters/${id}/sign`, {}, 'staff'),
  icd10: (q: string) => api.get<Icd10[]>('/v1/icd10', { q }, 'staff'),
  drugs: (q: string) => api.get<Drug[]>('/v1/drugs', { q }, 'staff'),
  rxTemplates: () => api.get<RxTemplate[]>('/v1/prescription-templates', undefined, 'staff'),
  createRx: (encounterId: string, lines: RxLineInput[], notes?: string) =>
    api.post<{ id: string; warnings: RxWarning[] }>(`/v1/encounters/${encounterId}/prescriptions`, { lines: lines.map(({ label: _l, ...l }) => l), notes }, 'staff'),
  issueRx: (id: string, acknowledgeWarnings: boolean) => api.post<{ id: string; shareLink: string }>(`/v1/prescriptions/${id}/issue`, { acknowledgeWarnings }, 'staff'),
  statements: () => api.get<CommissionStatement[]>('/v1/commission-statements', undefined, 'staff'),
  // Telemedicine (telemedicine.ts)
  videoVisits: (date: string) => api.get<DoctorVideoVisit[]>('/v1/telemedicine', { date }, 'staff'),
  startVideo: (appointmentId: string) => api.post<TelemedicineStart>(`/v1/telemedicine/${appointmentId}/start`, {}, 'staff'),
  endVideo: (appointmentId: string) => api.post<{ ok: true }>(`/v1/telemedicine/${appointmentId}/end`, {}, 'staff'),
  // AI scribe (ai.ts): typed text as JSON, or a recorded audio file as multipart `audio` (≤ 20 MB; webm/ogg/wav/mp3/m4a).
  dictation: (encounterId: string, text: string, language: 'ar' | 'en' | 'auto') =>
    request<AiDraft & { transcript: string }>(`/v1/encounters/${encounterId}/ai/dictation`, { method: 'POST', body: { text, language }, auth: 'staff', timeoutMs: 90000 }),
  dictationAudio: (encounterId: string, audio: FormData) =>
    request<AiDraft & { transcript: string }>(`/v1/encounters/${encounterId}/ai/dictation`, { method: 'POST', form: audio, auth: 'staff', timeoutMs: 180000 }),
  aiDraft: (id: string) => api.get<AiDraft>(`/v1/ai/drafts/${id}`, undefined, 'staff'),
  /** The signed-in doctor's own drafts for a visit, newest first; pending ones only from the last 24 h (ai.ts `drafts`). */
  aiDrafts: (q: { encounterId?: string; prescriptionId?: string; status?: AiDraft['status'] }) => api.get<AiDraft[]>('/v1/ai/drafts', { status: 'pending', ...q }, 'staff'),
  approveDraft: (id: string, b: ApproveEncounterDraft) => api.post<{ ok: true; applied: unknown }>(`/v1/ai/drafts/${id}/approve`, b, 'staff'),
  rejectDraft: (id: string) => api.post<{ ok: true }>(`/v1/ai/drafts/${id}/reject`, {}, 'staff'),
};

/**
 * Staff self-service HR (hr.ts) and payslips (payroll.ts). Every staff member may call these for their own records.
 * Errors: clock → no_active_contract, already_clocked_in, not_clocked_in, clock_location_not_allowed (403, details
 * {method, distance?, accuracy?}) when the clinic blocks clocking it cannot verify; leave → overlapping_leave,
 * insufficient_leave_balance {available}, leave_quota_exceeded {quota}, exceeds_max_consecutive_days {max},
 * no_working_days_in_range, leave_must_stay_within_one_year; permission → permission_allowance_exceeded
 * {perMonth, minutesPerMonth, used, usedMinutes}; cancel → 404 when the request can no longer be cancelled.
 */
export const hrApi = {
  me: () => api.get<HrMe>('/v1/hr/me', undefined, 'staff'),
  /** Same as `me`, with the permission allowance for another month (YYYY-MM). */
  meForMonth: (month: string) => api.get<HrMe>('/v1/hr/me', { month }, 'staff'),
  /**
   * The server stamps the time; the work day is the Cairo day of the clock-in. No position is sent: the app has no
   * location library yet, so only the clinic network can verify where the person is.
   */
  clock: (action: 'in' | 'out') => api.post<AttendanceRecord>('/v1/hr/attendance/clock', { action, source: 'mobile' }, 'staff'),
  month: (month: string) => api.get<HrMonth>('/v1/hr/me/attendance', { month }, 'staff'),
  balances: (year?: number) => api.get<HrBalances>('/v1/hr/me/balances', { year }, 'staff'),
  leaveTypes: () => api.get<LeaveType[]>('/v1/hr/leave-types', undefined, 'staff'),
  /** Days a leave range would use and what would remain, before submitting. */
  leavePreview: (q: { leaveTypeId: string; startDate: string; endDate: string }) => api.get<LeavePreview>('/v1/hr/leave-preview', q, 'staff'),
  requests: () => api.get<MyRequests>('/v1/hr/me/requests', undefined, 'staff'),
  requestLeave: (b: { leaveTypeId: string; startDate: string; endDate: string; reason?: string }) => api.post<LeaveRequest>('/v1/hr/leave-requests', b, 'staff'),
  requestPermission: (b: { workDate: string; kind: PermissionKind; startTime: string; endTime: string; reason?: string }) =>
    api.post<PermissionRequest>('/v1/hr/permission-requests', b, 'staff'),
  cancelLeave: (id: string) => api.post<{ ok: true }>(`/v1/hr/leave-requests/${id}/cancel`, {}, 'staff'),
  cancelPermission: (id: string) => api.post<{ ok: true }>(`/v1/hr/permission-requests/${id}/cancel`, {}, 'staff'),
  /** Approved and paid payslips, newest first (36 months). The PDF route needs a bearer header, see app/hr/payslip/[id].tsx. */
  payslips: () => api.get<MyPayslip[]>('/v1/payroll/me/payslips', undefined, 'staff'),
  /** 10-minute signed link to the payslip PDF (opens in the in-app browser without the sign-in header). */
  payslipLink: (id: string) => api.get<{ url: string; expiresInSeconds: number }>(`/v1/payroll/payslips/${encodeURIComponent(id)}/link`, undefined, 'staff'),
};

export const newIdempotencyKey = () => `app-${randomId()}`;
