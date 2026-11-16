import { describe, expect, it } from 'vitest';
import { decodeNationalId, formatLocalPhone, normalisePhone } from '../src';

describe('National ID (FR-PAT-2)', () => {
  it('decodes a valid 1990s male id', () => {
    const r = decodeNationalId('29001010112345');
    expect(r).toEqual({ ok: true, info: { nationalId: '29001010112345', dateOfBirth: '1990-01-01', governorateCode: '01', gender: 'female' } });
  });
  it('decodes 2000s, Arabic-Indic digits, gender by 13th digit', () => {
    const r = decodeNationalId('٣٠٥٠٣١٥٢١٠٠٠٣١');
    expect(r.ok && r.info).toMatchObject({ dateOfBirth: '2005-03-15', governorateCode: '21', gender: 'male' });
  });
  it.each([
    ['123', 'length'],
    ['19001010112345', 'century'],
    ['29002300112345', 'date'],
    ['29001019912345', 'governorate'],
  ])('rejects %s with %s', (id, error) => {
    expect(decodeNationalId(id)).toEqual({ ok: false, error });
  });
  it('rejects future birth dates', () => {
    expect(decodeNationalId('32712310112345', { today: new Date('2026-11-16') })).toEqual({ ok: false, error: 'date' });
  });
  it('checks consistency with entered DOB and gender', () => {
    expect(decodeNationalId('29001010112345', { dateOfBirth: '1990-01-02' })).toEqual({ ok: false, error: 'dob_mismatch' });
    expect(decodeNationalId('29001010112345', { gender: 'male' })).toEqual({ ok: false, error: 'gender_mismatch' });
  });
});

describe('Phone normalisation (FR-COM-6)', () => {
  it.each(['01012345678', '+201012345678', '00201012345678', '201012345678', '010 1234 5678', '٠١٠١٢٣٤٥٦٧٨'])('%s', (raw) => {
    expect(normalisePhone(raw)).toBe('+201012345678');
  });
  it('rejects invalid Egyptian prefixes', () => {
    expect(normalisePhone('01312345678')).toBeNull();
    expect(normalisePhone('+20101234567')).toBeNull();
  });
  it('accepts international numbers', () => {
    expect(normalisePhone('+966501234567')).toBe('+966501234567');
  });
  it('formats locally', () => {
    expect(formatLocalPhone('+201512345678')).toBe('015 1234 5678');
  });
});
