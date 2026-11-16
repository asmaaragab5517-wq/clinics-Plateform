import { toWesternDigits } from '../arabic';

export const EG_MOBILE_E164 = /^\+201[0125]\d{8}$/;

/**
 * Normalise a phone number to E.164 (FR-COM-6).
 * Egyptian mobiles may be entered as 01XXXXXXXXX, +201XXXXXXXXX, 00201… or 201….
 * International numbers must already carry a + or 00 prefix.
 * Returns null when the input is not a valid number.
 */
export function normalisePhone(raw: string): string | null {
  let s = toWesternDigits(raw).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^01\d{9}$/.test(s)) s = '+2' + s;
  else if (/^201\d{9}$/.test(s)) s = '+' + s;
  if (s.startsWith('+20')) return EG_MOBILE_E164.test(s) ? s : null;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}

export function isEgyptianMobile(e164: string): boolean {
  return EG_MOBILE_E164.test(e164);
}

/** Display an E.164 Egyptian mobile in local form 01X XXXX XXXX. */
export function formatLocalPhone(e164: string): string {
  if (!isEgyptianMobile(e164)) return e164;
  const local = '0' + e164.slice(3);
  return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
}
