import type { AppointmentStatus, BillStatus } from './enums';

/** Appointment status machine (FR-APT-2). */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  requested: ['booked', 'cancelled'],
  // booked → checked_in is allowed: patients who never answered the confirmation still turn up.
  booked: ['confirmed', 'checked_in', 'no_show', 'cancelled'],
  confirmed: ['checked_in', 'no_show', 'cancelled'],
  checked_in: ['in_consultation', 'cancelled'],
  in_consultation: ['completed', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
};

export const OPEN_APPOINTMENT_STATUSES: AppointmentStatus[] = ['requested', 'booked', 'confirmed', 'checked_in', 'in_consultation'];
/** Statuses that occupy slot capacity. */
export const CAPACITY_STATUSES: AppointmentStatus[] = ['requested', 'booked', 'confirmed', 'checked_in', 'in_consultation', 'completed'];

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

/** Bill status machine (FR-BIL-3). Payments and refunds drive the paid/refunded states. */
export const BILL_TRANSITIONS: Record<BillStatus, BillStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['partially_paid', 'paid', 'void'],
  partially_paid: ['paid', 'refunded'],
  paid: ['refunded'],
  void: [],
  refunded: [],
};

export function canTransitionBill(from: BillStatus, to: BillStatus): boolean {
  return BILL_TRANSITIONS[from].includes(to);
}

/** Derive a bill's payment status from totals. Refunds only reach `refunded` when fully refunded. */
export function billPaymentStatus(total: number, paid: number, refunded: number): Extract<BillStatus, 'issued' | 'partially_paid' | 'paid' | 'refunded'> {
  if (refunded > 0 && refunded >= paid) return 'refunded';
  const net = paid - refunded;
  if (net <= 0) return 'issued';
  if (net < total) return 'partially_paid';
  return 'paid';
}
