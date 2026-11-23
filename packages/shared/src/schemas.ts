import { z } from 'zod';
import { toWesternDigits } from './arabic';
import {
  APPOINTMENT_STATUSES,
  BOOKING_CHANNELS,
  CONSENT_TYPES,
  PAYMENT_METHODS,
  QUEUE_PRIORITIES,
  ROLES,
  SERVICE_TYPES,
  VAT_STATUSES,
} from './enums';
import { decodeNationalId } from './egypt/national-id';
import { normalisePhone } from './egypt/phone';
import { dentalChartSchema } from './dental';

export const zUuid = z.guid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');
export const zPiastres = z.number().int().nonnegative();
export const zLocale = z.enum(['ar', 'en']);
export const zBilingual = z.object({ ar: z.string().min(1).max(500), en: z.string().max(500).default('') });

export const zPhone = z
  .string()
  .transform((v, ctx) => {
    const p = normalisePhone(v);
    if (!p) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_phone' });
      return z.NEVER;
    }
    return p;
  });

export const zNationalId = z
  .string()
  .transform((v) => toWesternDigits(v).replace(/\s|-/g, ''))
  .refine((v) => decodeNationalId(v).ok, { message: 'invalid_national_id' });

// ---- Auth
export const otpRequestSchema = z.object({ phone: zPhone, purpose: z.enum(['login', 'link_family']).default('login') });
export const otpVerifySchema = z.object({ phone: zPhone, code: z.string().regex(/^\d{6}$/), deviceId: z.string().max(200).optional() });
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

// ---- Organisation & clinics
export const clinicSchema = z.object({
  legalEntityId: zUuid.optional(),
  name: zBilingual,
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
  governorate: z.string().min(2),
  city: z.string().min(1),
  addressLines: z.string().max(500).default(''),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phones: z.array(zPhone).max(5).default([]),
  email: z.string().email().optional(),
  workingHours: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), open: zTime, close: zTime }))
    .default([]),
  colours: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).partial().default({}),
  invoiceFooter: z.string().max(1000).default(''),
  isPublic: z.boolean().default(true),
});

export const serviceSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{2,30}$/),
  name: zBilingual,
  specialtyId: zUuid.optional(),
  durationMinutes: z.number().int().min(5).max(480),
  type: z.enum(SERVICE_TYPES),
  vat: z.enum(VAT_STATUSES),
  isActive: z.boolean().default(true),
});

export const priceSchema = z.object({
  clinicId: zUuid,
  serviceId: zUuid,
  doctorId: zUuid.nullable().optional(),
  price: zPiastres,
  effectiveFrom: zDate,
  effectiveTo: zDate.nullable().optional(),
});

export const packageSchema = z.object({
  serviceId: zUuid,
  name: zBilingual,
  sessions: z.number().int().min(1).max(200),
  validityDays: z.number().int().min(1).max(3650),
  price: zPiastres,
  familyShareable: z.boolean().default(false),
});

// ---- Staff
export const inviteStaffSchema = z.object({
  email: z.string().email().optional(),
  phone: zPhone.optional(),
  name: zBilingual,
  roles: z.array(z.enum(ROLES).exclude(['patient'])).min(1),
  clinicIds: z.array(zUuid).default([]),
});

export const doctorProfileSchema = z.object({
  title: z.enum(['prof', 'dr', 'consultant', 'specialist']),
  specialtyIds: z.array(zUuid).min(1),
  syndicateNumber: z.string().regex(/^\d{3,10}$/),
  qualifications: z.array(z.object({ degree: z.string(), institution: z.string(), year: z.number().int().min(1950).max(2100) })).default([]),
  languages: z.array(z.string()).default(['ar']),
  bio: zBilingual.optional(),
  gender: z.enum(['male', 'female']).optional(),
  isPublic: z.boolean().default(true),
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
});

// ---- Schedules
export const sessionSchema = z
  .object({
    clinicId: zUuid,
    doctorId: zUuid,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    startTime: zTime,
    endTime: zTime,
    slotMinutes: z.number().int().min(5).max(240),
    capacityPerSlot: z.number().int().min(1).max(20).default(1),
    walkInReserved: z.number().int().min(0).default(0),
    breaks: z.array(z.object({ start: zTime, end: zTime })).default([]),
    serviceIds: z.array(zUuid).default([]),
    effectiveFrom: zDate,
    effectiveTo: zDate.nullable().optional(),
    profileId: zUuid.nullable().optional(),
  })
  .refine((s) => s.startTime < s.endTime, { message: 'end_before_start', path: ['endTime'] });

export const scheduleExceptionSchema = z.object({
  kind: z.enum(['leave', 'holiday', 'extra']),
  clinicId: zUuid.optional(),
  doctorId: zUuid.optional(),
  date: zDate,
  startTime: zTime.optional(),
  endTime: zTime.optional(),
  reason: z.string().max(500).optional(),
});

// ---- Patients
export const patientSchema = z
  .object({
    nameAr: z.object({ first: z.string().min(1), father: z.string().default(''), grandfather: z.string().default(''), family: z.string().default('') }),
    nameEn: z.string().max(200).optional(),
    nationalId: zNationalId.optional(),
    passport: z.object({ number: z.string().min(4).max(20), nationality: z.string().length(2) }).optional(),
    dateOfBirth: zDate,
    gender: z.enum(['male', 'female']),
    phones: z.array(z.object({ number: zPhone, primary: z.boolean().default(false) })).min(1),
    email: z.string().email().optional(),
    governorate: z.string().optional(),
    city: z.string().optional(),
    address: z.string().max(500).optional(),
    maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']).optional(),
    occupation: z.string().max(100).optional(),
    emergencyContact: z.object({ name: z.string(), phone: zPhone, relation: z.string() }).optional(),
    guardianPatientId: zUuid.optional(),
    customFields: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((p, ctx) => {
    if (p.nationalId) {
      const r = decodeNationalId(p.nationalId, { dateOfBirth: p.dateOfBirth, gender: p.gender });
      if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nationalId'], message: `national_id_${r.error}` });
    }
  });

// ---- Appointments
export const createAppointmentSchema = z.object({
  patientId: zUuid,
  clinicId: zUuid,
  doctorId: zUuid,
  serviceIds: z.array(zUuid).min(1),
  start: z.string().datetime(),
  channel: z.enum(BOOKING_CHANNELS),
  paymentMode: z.enum(['online', 'at_clinic']).default('at_clinic'),
  notes: z.string().max(1000).optional(),
});
export const transitionAppointmentSchema = z.object({ to: z.enum(APPOINTMENT_STATUSES), reason: z.string().max(500).optional() });
export const rescheduleSchema = z.object({ start: z.string().datetime(), reason: z.string().max(500).optional() });
export const checkInSchema = z.object({ priority: z.enum(QUEUE_PRIORITIES).default('normal') });

export const publicBookingSchema = z.object({
  clinicId: zUuid,
  doctorId: zUuid,
  serviceId: zUuid,
  start: z.string().datetime(),
  patientId: zUuid,
  paymentMode: z.enum(['online', 'at_clinic']),
});

// ---- EMR
export const vitalsSchema = z
  .object({
    systolic: z.number().int().min(40).max(300),
    diastolic: z.number().int().min(20).max(200),
    heartRate: z.number().int().min(20).max(300),
    temperatureC: z.number().min(30).max(45),
    respiratoryRate: z.number().int().min(4).max(80),
    spo2: z.number().int().min(50).max(100),
    weightKg: z.number().min(0.3).max(400),
    heightCm: z.number().min(20).max(250),
    glucoseMgDl: z.number().min(10).max(1000),
  })
  .partial();

export const encounterUpdateSchema = z.object({
  vitals: vitalsSchema.optional(),
  chiefComplaint: z.string().max(5000).optional(),
  hpi: z.string().max(20000).optional(),
  examination: z.string().max(20000).optional(),
  notes: z.string().max(50000).optional(),
  diagnoses: z.array(z.object({ code: z.string().max(10), primary: z.boolean().default(false), note: z.string().max(500).optional() })).optional(),
  problems: z.array(z.object({ text: z.string().max(500), status: z.enum(['active', 'resolved']).default('active') })).optional(),
  observations: z.array(z.object({ name: z.string().max(200), value: z.string().max(500) })).optional(),
  bodyChart: z
    .object({ image: z.string().max(50), shapes: z.array(z.record(z.string(), z.unknown())).max(500), pngDataUrl: z.string().max(400_000).regex(/^data:image\/png;base64,/).optional() })
    .optional(),
  followUp: z.object({ date: zDate, serviceId: zUuid.optional(), note: z.string().max(500).optional() }).nullable().optional(),
  dentalChart: dentalChartSchema.nullable().optional(), // null clears the visit's chart
});

export const prescriptionLineSchema = z.object({
  drugId: zUuid.optional(),
  freeText: z.string().max(300).optional(),
  dose: z.string().max(100),
  route: z.string().max(50).default('oral'),
  frequency: z.string().max(200),
  durationDays: z.number().int().min(1).max(365).optional(),
  quantity: z.string().max(50).optional(),
  instructionsAr: z.string().max(500).default(''),
  instructionsEn: z.string().max(500).default(''),
}).refine((l) => l.drugId || l.freeText, { message: 'drug_or_free_text_required' });

export const prescriptionSchema = z.object({ lines: z.array(prescriptionLineSchema).min(1).max(30), notes: z.string().max(2000).optional() });

export const medicalHistoryItemSchema = z.object({
  kind: z.enum(['allergy', 'chronic', 'surgery', 'medication', 'family', 'social', 'immunisation']),
  text: z.string().min(1).max(500),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  ingredient: z.string().max(200).optional(),
  since: zDate.optional(),
});

export const orderSchema = z.object({ kind: z.enum(['lab', 'radiology']), testCodes: z.array(z.string()).min(1), note: z.string().max(1000).optional() });

// ---- Billing
export const billLineSchema = z.object({
  serviceId: zUuid.optional(),
  packageId: zUuid.optional(),
  description: z.string().max(300).optional(),
  qty: z.number().int().min(1).max(1000),
  unitPrice: zPiastres.optional(),
  discount: z.discriminatedUnion('type', [
    z.object({ type: z.literal('amount'), value: zPiastres }),
    z.object({ type: z.literal('percent'), value: z.number().min(0).max(100) }),
  ]).optional(),
  vat: z.enum(VAT_STATUSES).optional(),
});

export const createBillSchema = z.object({
  clinicId: zUuid,
  patientId: zUuid,
  appointmentId: zUuid.optional(),
  encounterId: zUuid.optional(),
  lines: z.array(billLineSchema).min(1),
  coverageId: zUuid.optional(),
  approvalNumber: z.string().max(60).optional(),
});

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().positive(),
  reference: z.string().max(100).optional(),
  cardLast4: z.string().regex(/^\d{4}$/).optional(),
  packageBalanceId: zUuid.optional(),
});

export const refundRequestSchema = z.object({ paymentId: zUuid, amount: z.number().int().positive(), reason: z.string().min(3).max(500) });

export const openShiftSchema = z.object({ clinicId: zUuid, openingFloat: zPiastres });
export const closeShiftSchema = z.object({ counts: z.record(z.string(), z.number().int().min(0)), note: z.string().max(500).optional() });

// ---- Privacy
export const consentSchema = z.object({ type: z.enum(CONSENT_TYPES), granted: z.boolean(), versionId: zUuid, channel: z.enum(['portal', 'app', 'reception', 'site']) });

// ---- Reviews
export const reviewSchema = z.object({ appointmentId: zUuid, rating: z.number().int().min(1).max(5), comment: z.string().max(2000).optional() });

export type PatientInput = z.infer<typeof patientSchema>;
export type ClinicInput = z.infer<typeof clinicSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type EncounterUpdate = z.infer<typeof encounterUpdateSchema>;
export type BillLine = z.infer<typeof billLineSchema>;
