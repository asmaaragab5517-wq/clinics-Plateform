export const ROLES = [
  'owner',
  'network_director',
  'clinic_manager',
  'doctor',
  'nurse',
  'receptionist',
  'accountant',
  'patient',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles whose scope is the whole organisation (not limited to clinic memberships). */
export const NETWORK_ROLES: readonly Role[] = ['owner', 'network_director', 'accountant'];

export const APPOINTMENT_STATUSES = [
  'requested',
  'booked',
  'confirmed',
  'checked_in',
  'in_consultation',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const BOOKING_CHANNELS = ['console', 'phone', 'walk_in', 'site', 'app', 'doctor_follow_up'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const BILL_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void', 'refunded'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'card_at_clinic', 'healthpay', 'package_balance', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const VAT_STATUSES = ['taxable', 'exempt', 'zero'] as const;
export type VatStatus = (typeof VAT_STATUSES)[number];

export const SERVICE_TYPES = ['consultation', 'follow_up', 'procedure', 'package', 'telemedicine'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const CHANNELS = ['sms', 'whatsapp', 'email', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CONSENT_TYPES = ['health_data', 'messaging', 'marketing', 'telemedicine', 'itqan_sharing'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const QUEUE_PRIORITIES = ['emergency', 'elderly', 'booked_on_time', 'normal'] as const;
export type QueuePriority = (typeof QUEUE_PRIORITIES)[number];

export const MESSAGE_EVENTS = [
  'booking_confirmed',
  'payment_pending',
  'payment_received',
  'reminder_24h',
  'reminder_2h',
  'rescheduled',
  'cancelled_by_clinic',
  'cancelled_by_patient',
  'checkin_ticket',
  'turn_approaching',
  'no_show_notice',
  'report_ready',
  'prescription_shared',
  'follow_up_due',
  'review_request',
  'otp',
  'staff_invite',
  'shift_variance_alert',
  'director_daily_summary',
] as const;
export type MessageEvent = (typeof MESSAGE_EVENTS)[number];

/** Events that bypass marketing opt-out and quiet hours (FR-COM-4). */
export const TRANSACTIONAL_URGENT_EVENTS: readonly MessageEvent[] = ['otp', 'turn_approaching', 'checkin_ticket'];

export const PRIVILEGE_MODULES = [
  'org',
  'clinic',
  'staff',
  'schedule',
  'appointment',
  'queue',
  'patient',
  'emr',
  'prescription',
  'bill',
  'payment',
  'refund',
  'shift',
  'commission',
  'report',
  'message',
  'review',
  'import',
  'privacy',
  'audit',
  'settings',
  'quality',
  'integration',
  'hr',
  'payroll',
] as const;
export type PrivilegeModule = (typeof PRIVILEGE_MODULES)[number];
export const PRIVILEGE_ACTIONS = ['view', 'create', 'edit', 'approve', 'delete', 'export'] as const;
export type PrivilegeAction = (typeof PRIVILEGE_ACTIONS)[number];
export type Privilege = `${PrivilegeModule}:${PrivilegeAction}`;
