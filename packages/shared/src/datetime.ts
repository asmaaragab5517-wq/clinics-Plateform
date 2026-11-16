export const CLINIC_TZ = 'Africa/Cairo';

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(timeZone, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** Offset in minutes of `timeZone` from UTC at instant `date`. */
export function tzOffsetMinutes(date: Date, timeZone = CLINIC_TZ): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock date (YYYY-MM-DD) + time (HH:mm) in Cairo to a UTC instant, DST-aware (FR-SCH-4). */
export function zonedToUtc(date: string, time: string, timeZone = CLINIC_TZ): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMinutes(new Date(guess), timeZone);
  let ts = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(ts), timeZone);
  if (off2 !== off) {
    off = off2;
    ts = guess - off * 60000;
  }
  return new Date(ts);
}

/** Local calendar date (YYYY-MM-DD) in Cairo for an instant. */
export function localDate(date: Date, timeZone = CLINIC_TZ): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localTime(date: Date, timeZone = CLINIC_TZ): string {
  const p = parts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** Day of week 0=Sunday … 6=Saturday for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Week starts on Saturday (FR-SCH-5, LOC-5). Returns the Saturday on or before `date`. */
export function startOfWeek(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, -((wd + 1) % 7));
}

/** Weekday order for calendar headers, starting Saturday. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Format dd/MM/yyyy (LOC-5). */
export function formatDate(date: Date, timeZone = CLINIC_TZ): string {
  const [y, m, d] = localDate(date, timeZone).split('-');
  return `${d}/${m}/${y}`;
}

/** 12-hour time with ص/م in Arabic, AM/PM in English (LOC-5). */
export function formatTime12(date: Date, locale: 'ar' | 'en', timeZone = CLINIC_TZ): string {
  const [hStr, mStr] = localTime(date, timeZone).split(':') as [string, string];
  const h = Number(hStr);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = locale === 'ar' ? (h < 12 ? 'ص' : 'م') : h < 12 ? 'AM' : 'PM';
  return `${h12}:${mStr} ${suffix}`;
}

export function formatHijri(date: Date, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-ca-islamic-umalqura-nu-latn' : 'en-u-ca-islamic-umalqura', {
    timeZone: CLINIC_TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const ARABIC_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function ageInYears(dob: string, on: Date = new Date()): number {
  const today = localDate(on);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
