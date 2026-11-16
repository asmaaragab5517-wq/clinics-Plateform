import type { QueuePriority } from './enums';

export interface QueueEntry {
  id: string;
  ticketNumber: number;
  priority: QueuePriority;
  checkedInAt: string; // ISO
  status: 'waiting' | 'called' | 'serving' | 'done' | 'skipped';
}

const RANK: Record<QueuePriority, number> = { emergency: 0, elderly: 1, booked_on_time: 2, normal: 3 };

/** Order a doctor's waiting queue: priority override first, then check-in time (FR-APT-5). */
export function orderQueue<T extends QueueEntry>(entries: T[]): T[] {
  return entries
    .filter((e) => e.status === 'waiting')
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.checkedInAt.localeCompare(b.checkedInAt) || a.ticketNumber - b.ticketNumber);
}

/** Position (1-based) of a ticket in the waiting queue, or null if not waiting. */
export function queuePosition(entries: QueueEntry[], id: string): number | null {
  const idx = orderQueue(entries).findIndex((e) => e.id === id);
  return idx < 0 ? null : idx + 1;
}
