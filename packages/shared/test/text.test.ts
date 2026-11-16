import { describe, expect, it } from 'vitest';
import { catalogs, nameSimilarity, normaliseArabic, slugify, smsSegments, t, inQuietHours, patientSchema, hasPrivilege, privilegesForRoles } from '../src';

describe('Arabic', () => {
  it('normalises letters, diacritics and digits', () => {
    expect(normaliseArabic('أحمد  إبراهيم')).toBe('احمد ابراهيم');
    expect(normaliseArabic('فاطمة')).toBe(normaliseArabic('فاطمه'));
    expect(normaliseArabic('مُصْطَفَى')).toBe('مصطفي');
    expect(normaliseArabic('١٢٣')).toBe('123');
  });
  it('fuzzy matches names', () => {
    expect(nameSimilarity('محمد أحمد علي', 'محمد احمد على')).toBe(1);
    expect(nameSimilarity('محمد', 'سارة')).toBeLessThan(0.5);
  });
  it('slugifies', () => {
    expect(slugify('Dr. Ahmed Ali')).toBe('dr-ahmed-ali');
    expect(slugify('عيادة المعادي')).toMatch(/^[a-z-]+$/);
  });
});

describe('SMS segments (FR-COM-2)', () => {
  it('GSM-7', () => {
    expect(smsSegments('a'.repeat(160)).segments).toBe(1);
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
  });
  it('UCS-2 Arabic 70/67', () => {
    expect(smsSegments('م'.repeat(70))).toMatchObject({ encoding: 'UCS-2', segments: 1 });
    expect(smsSegments('م'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
  });
  it('quiet hours', () => {
    expect(inQuietHours('23:00')).toBe(true);
    expect(inQuietHours('08:59')).toBe(true);
    expect(inQuietHours('09:00')).toBe(false);
  });
});

describe('i18n (LOC-1)', () => {
  it('ar and en catalogues have identical keys', () => {
    expect(Object.keys(catalogs.ar).sort()).toEqual(Object.keys(catalogs.en).sort());
  });
  it('renders variables', () => {
    expect(t('ar', 'msg.otp', { code: '123456' })).toContain('123456');
  });
});

describe('patient schema', () => {
  it('validates NID consistency', () => {
    const r = patientSchema.safeParse({
      nameAr: { first: 'منى' }, dateOfBirth: '1990-01-01', gender: 'male', nationalId: '29001010112345', phones: [{ number: '01012345678' }],
    });
    expect(r.success).toBe(false);
    const ok = patientSchema.parse({ nameAr: { first: 'منى' }, dateOfBirth: '1990-01-01', gender: 'female', nationalId: '29001010112345', phones: [{ number: '01012345678' }] });
    expect(ok.phones[0]!.number).toBe('+201012345678');
  });
});

describe('privileges', () => {
  it('receptionist cannot view EMR; doctor can', () => {
    expect(hasPrivilege(privilegesForRoles(['receptionist']), 'emr:view')).toBe(false);
    expect(hasPrivilege(privilegesForRoles(['doctor']), 'emr:view')).toBe(true);
    expect(hasPrivilege(privilegesForRoles(['accountant']), 'emr:view')).toBe(false);
  });
});
