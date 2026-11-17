import { z } from 'zod';

/** FDI two-digit tooth notation: permanent 11-18, 21-28, 31-38, 41-48; primary 51-55, 61-65, 71-75, 81-85. */
export const PERMANENT_TEETH = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((t) => q * 10 + t));
export const PRIMARY_TEETH = [5, 6, 7, 8].flatMap((q) => [1, 2, 3, 4, 5].map((t) => q * 10 + t));
export const ALL_TEETH = new Set([...PERMANENT_TEETH, ...PRIMARY_TEETH]);

export const TOOTH_SURFACES = ['M', 'O', 'D', 'B', 'L', 'I'] as const; // mesial, occlusal, distal, buccal, lingual/palatal, incisal
export const TOOTH_STATUSES = ['present', 'missing', 'extracted', 'implant', 'unerupted', 'impacted'] as const;
export const TOOTH_CONDITIONS = ['caries', 'filling', 'crown', 'root_canal', 'fracture', 'bridge_abutment', 'bridge_pontic', 'sealant', 'veneer', 'mobility', 'periapical_lesion', 'wear'] as const;
export const DENTAL_PROCEDURES = ['examination', 'scaling', 'filling', 'root_canal', 'extraction', 'crown', 'bridge', 'implant', 'veneer', 'sealant', 'whitening', 'orthodontic'] as const;

/** Anterior teeth have an incisal edge rather than an occlusal surface. */
export function isAnterior(tooth: number): boolean {
  return [1, 2, 3].includes(tooth % 10);
}

const surfaces = z.array(z.enum(TOOTH_SURFACES)).max(5).optional();

export const toothSchema = z
  .object({
    tooth: z.number().int().refine((t) => ALL_TEETH.has(t), 'invalid_tooth_number'),
    status: z.enum(TOOTH_STATUSES).default('present'),
    conditions: z.array(z.object({ type: z.enum(TOOTH_CONDITIONS), surfaces })).max(12).default([]),
    planned: z.array(z.object({ procedure: z.enum(DENTAL_PROCEDURES), surfaces, note: z.string().max(300).optional(), done: z.boolean().default(false) })).max(12).default([]),
    note: z.string().max(500).optional(),
  })
  .superRefine((t, ctx) => {
    const all = [...t.conditions.flatMap((c) => c.surfaces ?? []), ...t.planned.flatMap((p) => p.surfaces ?? [])];
    if (all.includes('I') && !isAnterior(t.tooth)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'incisal_surface_on_posterior_tooth' });
    if (all.includes('O') && isAnterior(t.tooth)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'occlusal_surface_on_anterior_tooth' });
    if (['missing', 'extracted'].includes(t.status) && t.conditions.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'conditions_on_missing_tooth' });
  });

/** Dental chart (FR-EMR-3 Dentistry template, R2): one entry per charted tooth, periodontal notes and dentition. */
export const dentalChartSchema = z
  .object({
    dentition: z.enum(['permanent', 'primary', 'mixed']).default('permanent'),
    teeth: z.array(toothSchema).max(52),
    periodontal: z.object({ bleedingOnProbing: z.boolean().optional(), plaqueIndex: z.number().min(0).max(3).optional(), notes: z.string().max(2000).optional() }).optional(),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<number>();
    for (const t of c.teeth) {
      if (seen.has(t.tooth)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate_tooth_${t.tooth}` });
      seen.add(t.tooth);
    }
  });

export type DentalChart = z.infer<typeof dentalChartSchema>;

/** Merge a visit's chart over the patient's previous chart: teeth not charted this visit keep their last state. */
export function mergeDentalCharts(previous: DentalChart | null, current: DentalChart): DentalChart {
  if (!previous) return current;
  const byTooth = new Map(previous.teeth.map((t) => [t.tooth, t]));
  for (const t of current.teeth) byTooth.set(t.tooth, t);
  return { ...current, teeth: [...byTooth.values()].sort((a, b) => a.tooth - b.tooth) };
}

/** Open (not done) planned procedures across the chart - the treatment plan. */
export function treatmentPlan(chart: DentalChart) {
  return chart.teeth.flatMap((t) => t.planned.filter((p) => !p.done).map((p) => ({ tooth: t.tooth, ...p })));
}
