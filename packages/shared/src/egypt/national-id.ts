import { toWesternDigits } from '../arabic';
import { FOREIGN_BORN_CODE, GOVERNORATE_BY_CODE } from './governorates';

export interface NationalIdInfo {
  nationalId: string;
  dateOfBirth: string; // YYYY-MM-DD
  governorateCode: string;
  gender: 'male' | 'female';
}

export type NationalIdError = 'length' | 'century' | 'date' | 'governorate' | 'dob_mismatch' | 'gender_mismatch';

export type NationalIdResult = { ok: true; info: NationalIdInfo } | { ok: false; error: NationalIdError };

/**
 * Validate and decode a 14-digit Egyptian National ID (FR-PAT-2).
 * Layout: C YYMMDD GG SSSS K where C=2 (1900s) or 3 (2000s), GG governorate,
 * the 13th digit's parity gives gender (odd = male) and K is a check digit.
 */
export function decodeNationalId(
  raw: string,
  opts: { dateOfBirth?: string; gender?: 'male' | 'female'; today?: Date } = {},
): NationalIdResult {
  const id = toWesternDigits(raw).replace(/\s|-/g, '');
  if (!/^\d{14}$/.test(id)) return { ok: false, error: 'length' };
  const century = id[0] === '2' ? 1900 : id[0] === '3' ? 2000 : null;
  if (century === null) return { ok: false, error: 'century' };
  const yy = Number(id.slice(1, 3));
  const mm = Number(id.slice(3, 5));
  const dd = Number(id.slice(5, 7));
  const year = century + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  const today = opts.today ?? new Date();
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd || d.getTime() > today.getTime()) {
    return { ok: false, error: 'date' };
  }
  const gov = id.slice(7, 9);
  if (!GOVERNORATE_BY_CODE.has(gov) && gov !== FOREIGN_BORN_CODE) return { ok: false, error: 'governorate' };
  const gender = Number(id[12]) % 2 === 1 ? 'male' : 'female';
  const dateOfBirth = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (opts.dateOfBirth && opts.dateOfBirth !== dateOfBirth) return { ok: false, error: 'dob_mismatch' };
  if (opts.gender && opts.gender !== gender) return { ok: false, error: 'gender_mismatch' };
  return { ok: true, info: { nationalId: id, dateOfBirth, governorateCode: gov, gender } };
}
