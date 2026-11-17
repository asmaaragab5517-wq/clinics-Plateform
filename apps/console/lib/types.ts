import type { AppointmentStatus, QueuePriority } from '@hf/shared';

export interface Me {
  userId: string;
  orgId: string;
  name: string;
  roles: string[];
  memberships: { role: string; clinicId: string | null }[];
  network: boolean;
  clinics: Clinic[];
  privileges: string[];
  authTime: number | null;
}

export interface Clinic {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
}

export interface PatientRow {
  id: string;
  mrn: string;
  first_name_ar: string;
  father_name_ar: string;
  grandfather_name_ar?: string;
  family_name_ar: string;
  name_en: string | null;
  date_of_birth: string;
  gender: 'male' | 'female';
  phone: string | null;
  governorate?: string | null;
  city?: string | null;
}

export interface AppointmentRow {
  id: string;
  ref: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  channel: string;
  payment_mode: string;
  is_walk_in: boolean;
  notes: string | null;
  patient_name: string;
  mrn: string;
  doctor_name: string;
  services: { id: string; name_ar: string; name_en: string }[];
  ticket_number: number | null;
  encounter_id?: string | null;
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
  encounter_id?: string | null;
}

export interface QueueGroup {
  doctorId: string;
  doctorName: string;
  serving: QueueTicket | null;
  called: QueueTicket | null;
  waiting: QueueTicket[];
  done: number;
}

export interface SessionRow {
  id: string;
  clinic_id: string;
  doctor_id: string;
  doctor_name: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity_per_slot: number;
  walk_in_reserved: number;
  overbook_per_slot?: number;
  service_ids: string[];
  effective_from: string;
  effective_to: string | null;
  profile_id: string | null;
}

export interface ServiceRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  specialty_id: string | null;
  duration_minutes: number;
  type: string;
  vat: 'taxable' | 'exempt' | 'zero';
  is_active: boolean;
}

export interface PriceRow {
  id: string;
  clinic_id: string;
  service_id: string;
  doctor_id: string | null;
  price: number;
  effective_from: string;
  effective_to: string | null;
  code: string;
  name_ar: string;
  name_en: string;
  vat: string;
}

export interface PackageRow {
  id: string;
  service_id: string;
  name_ar: string;
  name_en: string;
  sessions: number;
  validity_days: number;
  price: number;
  family_shareable: boolean;
}

export interface Slot {
  sessionId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  localStart: string;
  start: string;
  end: string;
  capacity: number;
  booked: number;
  available: number;
}

export interface EncounterListRow {
  id: string;
  clinic_id: string;
  clinic_name: string;
  doctor_id: string;
  doctor_name: string;
  status: 'open' | 'signed';
  chief_complaint: string;
  diagnoses: { code: string; primary: boolean }[];
  created_at: string;
  signed_at: string | null;
}

export interface DoctorRow {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  title: string;
  syndicate_number: string;
  is_public: boolean;
  clinic_ids: string[];
  specialty_ids: string[];
  service_ids: string[];
}

export interface StaffRow {
  id: string;
  name_ar: string;
  name_en: string;
  email: string | null;
  phone: string | null;
  status: string;
  mfa_enrolled: boolean;
  last_login_at: string | null;
  memberships: { role: string; clinicId: string | null }[];
}

export interface BillRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string | null;
  encounter_id: string | null;
  number: string | null;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void' | 'refunded';
  subtotal: number;
  discount: number;
  taxable_base: number;
  vat: number;
  total: number;
  paid: number;
  refunded: number;
  credited?: number;
  issued_at: string | null;
  created_at: string;
  patient_name?: string;
  mrn?: string;
}
