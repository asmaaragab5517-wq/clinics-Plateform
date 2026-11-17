import { describe, expect, it } from 'vitest';
import { dentalChartSchema, mergeDentalCharts, treatmentPlan, ALL_TEETH } from '../src';

describe('dental chart (FR-EMR-3, R2)', () => {
  it('knows the 52 FDI teeth', () => {
    expect(ALL_TEETH.size).toBe(52);
    expect(ALL_TEETH.has(19)).toBe(false);
    expect(ALL_TEETH.has(85)).toBe(true);
  });
  it('validates surfaces against tooth type and duplicates', () => {
    expect(dentalChartSchema.safeParse({ teeth: [{ tooth: 36, conditions: [{ type: 'caries', surfaces: ['O', 'D'] }] }] }).success).toBe(true);
    expect(dentalChartSchema.safeParse({ teeth: [{ tooth: 11, conditions: [{ type: 'caries', surfaces: ['O'] }] }] }).success).toBe(false);
    expect(dentalChartSchema.safeParse({ teeth: [{ tooth: 46, conditions: [{ type: 'filling', surfaces: ['I'] }] }] }).success).toBe(false);
    expect(dentalChartSchema.safeParse({ teeth: [{ tooth: 46, status: 'extracted', conditions: [{ type: 'caries' }] }] }).success).toBe(false);
    expect(dentalChartSchema.safeParse({ teeth: [{ tooth: 46 }, { tooth: 46 }] }).success).toBe(false);
    expect(dentalChartSchema.safeParse({ teeth: [{ tooth: 19 }] }).success).toBe(false);
  });
  it('merges over the previous chart and lists open treatment', () => {
    const prev = dentalChartSchema.parse({ teeth: [{ tooth: 16, conditions: [{ type: 'filling', surfaces: ['O'] }] }, { tooth: 36, planned: [{ procedure: 'root_canal' }] }] });
    const cur = dentalChartSchema.parse({ teeth: [{ tooth: 36, conditions: [{ type: 'root_canal' }], planned: [{ procedure: 'root_canal', done: true }, { procedure: 'crown' }] }] });
    const m = mergeDentalCharts(prev, cur);
    expect(m.teeth.map((t) => t.tooth)).toEqual([16, 36]);
    expect(treatmentPlan(m)).toEqual([{ tooth: 36, procedure: 'crown', done: false }]);
  });
});
