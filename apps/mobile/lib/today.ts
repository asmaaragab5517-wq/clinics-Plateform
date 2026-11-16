import { addDays, localDate, zonedToUtc } from '@hf/shared';

/** Today's [from, to) range in Africa/Cairo as ISO instants (DST-aware via @hf/shared). */
export function todayRange(): { from: string; to: string; date: string } {
  const d = localDate(new Date());
  return { from: zonedToUtc(d, '00:00').toISOString(), to: zonedToUtc(addDays(d, 1), '00:00').toISOString(), date: d };
}
