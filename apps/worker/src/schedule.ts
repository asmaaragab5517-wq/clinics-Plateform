/** Job schedule (Africa/Cairo). Intervals in ms or cron patterns for BullMQ repeatable jobs. */
export const SCHEDULE: { name: string; every?: number; cron?: string }[] = [
  { name: 'dispatch-messages', every: 15_000 },
  { name: 'expire-holds', every: 60_000 },
  { name: 'reminders', every: 5 * 60_000 },
  { name: 'no-shows', every: 5 * 60_000 },
  { name: 'refresh-reports', every: 5 * 60_000 },
  { name: 'follow-ups-waitlist', every: 10 * 60_000 },
  { name: 'telemedicine', every: 5 * 60_000 },
  { name: 'calendar-sync', every: 5 * 60_000 },
  { name: 'eta-receipts', every: 60_000 },
  { name: 'reconcile', cron: '30 2 * * *' },
  { name: 'verify-audit', cron: '0 3 * * *' },
  { name: 'retention', cron: '30 3 * * *' },
  { name: 'director-summary', cron: '0 8 * * *' },
  { name: 'commissions', cron: '0 4 1 * *' },
];

/** Minimal cron matcher for the dev scheduler (minute hour dom month dow), evaluated in Cairo time. */
export function cronMatches(pattern: string, d: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const values = [Number(get('minute')), Number(get('hour')), Number(get('day')), Number(get('month')), dow];
  return pattern.split(' ').every((f, i) => f === '*' || f.split(',').some((x) => Number(x) === values[i]));
}
