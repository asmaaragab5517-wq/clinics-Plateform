import { divRoundHalfUp, type Piastres } from './money';

export interface CoveragePlan {
  coveragePercent: number; // default share paid by the payer
  copayFixed: Piastres; // fixed amount always paid by the patient per bill
  typeOverrides?: Record<string, number>; // service type → coverage percent
  excludedServiceIds?: string[];
}

export interface CoverageLine {
  serviceId: string | null;
  serviceType: string | null;
  total: Piastres; // line total including VAT
}

/**
 * Split a bill between payer and patient (FR-BIL-11). Coverage is applied per line (type overrides, exclusions),
 * then the fixed co-pay moves from the payer share to the patient. Rounding half-up per line.
 */
export function splitCoverage(plan: CoveragePlan, lines: CoverageLine[]): { insurer: Piastres; patient: Piastres; perLine: Piastres[] } {
  const perLine = lines.map((l) => {
    if (l.serviceId && plan.excludedServiceIds?.includes(l.serviceId)) return 0;
    const override = l.serviceType ? plan.typeOverrides?.[l.serviceType] : undefined;
    const pct = override ?? plan.coveragePercent;
    return divRoundHalfUp(l.total * Math.round(pct * 100), 10000);
  });
  const total = lines.reduce((a, l) => a + l.total, 0);
  let insurer = perLine.reduce((a, x) => a + x, 0);
  insurer = Math.max(0, insurer - Math.min(plan.copayFixed, insurer));
  return { insurer, patient: total - insurer, perLine };
}
