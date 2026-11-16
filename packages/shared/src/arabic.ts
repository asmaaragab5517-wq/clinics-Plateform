const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Convert Arabic-Indic and Persian digits to Western digits (LOC-4). */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = ARABIC_INDIC.indexOf(ch);
    return String(i >= 0 ? i : EASTERN_ARABIC_INDIC.indexOf(ch));
  });
}

export function toArabicIndicDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]!);
}

/**
 * Normalise Arabic text for search and duplicate detection (FR-PAT-5, LOC-8):
 * strips diacritics and tatweel, unifies alef forms, taa marbuta and alef maqsura.
 */
export function normaliseArabic(input: string): string {
  return toWesternDigits(input)
    .normalize('NFKC')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Similarity 0..1 of two names after Arabic normalisation. */
export function nameSimilarity(a: string, b: string): number {
  const x = normaliseArabic(a);
  const y = normaliseArabic(b);
  const max = Math.max(x.length, y.length);
  return max === 0 ? 1 : 1 - levenshtein(x, y) / max;
}

/** Simple Arabic → Latin transliteration for slugs (FR-WEB-4). */
const TRANSLIT: Record<string, string> = {
  ا: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h',
  و: 'w', ي: 'y', ء: '',
};

export function slugify(input: string): string {
  const s = normaliseArabic(input)
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('');
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
