import { api, request } from './api';
import { randomId } from './random';
import type {
  BookingResponse,
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
  PortalDocument,
  PortalInvoice,
  PortalMe,
  PortalNotification,
  PortalPackage,
  PortalPrescription,
  PortalVisit,
  PublicService,
  QueueGroup,
  QueuePosition,
  RxLineInput,
  RxTemplate,
  RxWarning,
  Slot,
  Specialty,
  StaffAppointment,
  StaffMe,
  StaffPatient,
  Vitals,
} from './types';
import type { ConsentType, QueuePriority } from '@hf/shared';

/** Typed helpers, one per API route used by the app. Route sources: apps/api/src/modules/*.ts. */
export const authApi = {
  requestOtp: (phone: string) => api.post<OtpRequestResponse>('/v1/auth/otp/request', { phone, purpose: 'login' }),
  verifyOtp: (phone: string, code: string, deviceId: string) => api.post<OtpVerifyResponse>('/v1/auth/otp/verify', { phone, code, deviceId }),
  logout: () => api.post<{ ok: true }>('/v1/auth/logout', {}, 'patient'),
  staffMe: () => api.get<StaffMe>('/v1/auth/me', undefined, 'staff'),
};

export const publicApi = {
  specialties: () => api.get<Specialty[]>('/v1/public/specialties'),
  doctors: (f: { specialty?: string; q?: string; clinicId?: string }) => api.get<DoctorSummary[]>('/v1/public/doctors', f),
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
  appointments: (scope: 'upcoming' | 'past') => api.get<PortalAppointment[]>('/v1/portal/appointments', { scope }, 'patient'),
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
  invoices: () => api.get<PortalInvoice[]>('/v1/portal/invoices', undefined, 'patient'),
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
};

export const staffApi = {
  appointments: (q: { clinicId?: string; doctorId?: string; from: string; to: string; status?: string }) => api.get<StaffAppointment[]>('/v1/appointments', q, 'staff'),
  queue: (clinicId: string, doctorId?: string) => api.get<QueueGroup[]>('/v1/queue', { clinicId, doctorId }, 'staff'),
  callNext: (clinicId: string, doctorId: string) => api.post<{ called: { id: string; ticketNumber: number; appointmentId: string } }>('/v1/queue/call-next', { clinicId, doctorId }, 'staff'),
  updateTicket: (id: string, b: { priority?: QueuePriority; status?: 'waiting' | 'skipped' }) => api.patch<{ ok: true }>(`/v1/queue/${id}`, b, 'staff'),
  transition: (id: string, to: 'confirmed' | 'checked_in' | 'in_consultation' | 'completed' | 'no_show' | 'cancelled', reason?: string) =>
    api.post(`/v1/appointments/${id}/transition`, { to, reason }, 'staff'),
  checkIn: (id: string, priority?: QueuePriority) => api.post<{ ticket: { ticket_number: number } | null; packages: unknown[] }>(`/v1/appointments/${id}/check-in`, priority ? { priority } : {}, 'staff'),
  walkIn: (b: { patientId: string; clinicId: string; doctorId: string; serviceIds: string[]; priority: QueuePriority }) =>
    api.post<{ ticket: { ticket_number: number } | null }>('/v1/appointments/walk-in', b, 'staff'),
  searchPatients: (q: string) => api.get<PatientSearchRow[]>('/v1/patients', { q }, 'staff'),
  patient: (id: string) => api.get<StaffPatient>(`/v1/patients/${id}`, undefined, 'staff'),
  history: (id: string) => api.get<HistoryItem[]>(`/v1/patients/${id}/history`, undefined, 'staff'),
  encounters: (patientId: string) => api.get<EncounterListRow[]>(`/v1/patients/${patientId}/encounters`, undefined, 'staff'),
  encounter: (id: string) => api.get<Encounter>(`/v1/encounters/${id}`, undefined, 'staff'),
  updateEncounter: (id: string, b: { vitals?: Vitals; chiefComplaint?: string; notes?: string; diagnoses?: { code: string; primary: boolean }[] }) =>
    api.patch<Encounter>(`/v1/encounters/${id}`, b, 'staff'),
  signEncounter: (id: string) => api.post<Encounter>(`/v1/encounters/${id}/sign`, {}, 'staff'),
  icd10: (q: string) => api.get<Icd10[]>('/v1/icd10', { q }, 'staff'),
  drugs: (q: string) => api.get<Drug[]>('/v1/drugs', { q }, 'staff'),
  rxTemplates: () => api.get<RxTemplate[]>('/v1/prescription-templates', undefined, 'staff'),
  createRx: (encounterId: string, lines: RxLineInput[], notes?: string) =>
    api.post<{ id: string; warnings: RxWarning[] }>(`/v1/encounters/${encounterId}/prescriptions`, { lines: lines.map(({ label: _l, ...l }) => l), notes }, 'staff'),
  issueRx: (id: string, acknowledgeWarnings: boolean) => api.post<{ id: string; shareLink: string }>(`/v1/prescriptions/${id}/issue`, { acknowledgeWarnings }, 'staff'),
  statements: () => api.get<CommissionStatement[]>('/v1/commission-statements', undefined, 'staff'),
};

export const newIdempotencyKey = () => `app-${randomId()}`;
