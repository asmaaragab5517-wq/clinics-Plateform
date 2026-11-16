'use client';

import { useCallback } from 'react';
import { QUEUE_PRIORITIES, type QueuePriority } from '@hf/shared';
import { Badge, Bdi, Button, Select, cx } from '@hf/ui';
import { post, qs } from '@/lib/api';
import { useApi, useEventSource, useInterval } from '@/lib/hooks';
import { sendOrQueue } from '@/lib/offline';
import type { QueueGroup, QueueTicket } from '@/lib/types';
import { DataState } from './common';
import { useI18n } from './i18n';
import { useSession } from './session';
import { useToast } from './toast';

/** Live queue per doctor (FR-APT-5): SSE through the BFF, priority override and skip, display-screen link. */
export function useQueue(clinicId: string, doctorId?: string) {
  const q = useApi<QueueGroup[]>(clinicId ? `/queue${qs({ clinicId, doctorId })}` : null);
  const reload = q.reload;
  const live = useEventSource(clinicId ? `/api/v1/queue/stream${qs({ clinicId })}` : null, useCallback(() => reload(), [reload]));
  useInterval(reload, live ? null : 30_000);
  return { ...q, live };
}

export function QueueBoard({ doctorId, onSelectTicket, compact }: { doctorId?: string; onSelectTicket?: (t: QueueTicket) => void; compact?: boolean }) {
  const { t, err } = useI18n();
  const { clinicId, can } = useSession();
  const toast = useToast();
  const q = useQueue(clinicId, doctorId);
  const editable = can('queue:edit');

  async function update(ticket: QueueTicket, body: { priority?: QueuePriority; status?: 'skipped' | 'waiting' }) {
    try {
      const r = await sendOrQueue('PATCH', `/queue/${ticket.id}`, body, body.status ? 'offline.label.skip' : 'offline.label.priority');
      if (r.queued) toast(t('offline.queued'), 'warning');
      else q.reload();
    } catch (e) {
      toast(err(e), 'danger');
    }
  }

  async function openDisplay() {
    try {
      const r = await post<{ token: string }>(`/clinics/${clinicId}/display-token`);
      window.open(`/display?token=${encodeURIComponent(r.token)}`, '_blank', 'noopener');
    } catch (e) {
      toast(err(e), 'danger');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx('text-xs', q.live ? 'text-success' : 'text-muted')} role="status">
          {q.live ? t('queue.live') : t('queue.polling')}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={q.reload}>
            {t('common.refresh')}
          </Button>
          {editable && !compact && (
            <Button size="sm" variant="secondary" onClick={() => void openDisplay()}>
              {t('queue.openDisplay')}
            </Button>
          )}
        </div>
      </div>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(groups) => (
          <div className={cx('grid gap-3', !compact && 'md:grid-cols-2')}>
            {groups.map((g) => (
              <section key={g.doctorId} className="rounded-xl border border-border p-3" aria-label={g.doctorName}>
                <header className="mb-2 flex items-center justify-between gap-2">
                  <Bdi className="font-medium">{g.doctorName}</Bdi>
                  <span className="text-xs text-muted">{t('queue.doneCount', { n: g.done })}</span>
                </header>
                <div className="mb-2 flex gap-3 text-sm">
                  <span>
                    {t('queue.nowServing')}: <strong className="num text-lg">{g.serving?.ticket_number ?? g.called?.ticket_number ?? '—'}</strong>
                  </span>
                  {g.called && g.serving && (
                    <span className="text-muted">
                      {t('queue.called')}: <span className="num">{g.called.ticket_number}</span>
                    </span>
                  )}
                </div>
                {g.waiting.length === 0 ? (
                  <p className="text-sm text-muted">{t('queue.empty')}</p>
                ) : (
                  <ol className="flex flex-col gap-1">
                    {g.waiting.map((w, i) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm">
                        <span className="num w-8 font-bold">{w.ticket_number}</span>
                        <button type="button" className="min-w-0 flex-1 truncate text-start hover:underline" onClick={() => onSelectTicket?.(w)} disabled={!onSelectTicket}>
                          <Bdi>{w.patient_name ?? ''}</Bdi>
                        </button>
                        {w.priority !== 'normal' && <Badge tone={w.priority === 'emergency' ? 'danger' : 'warning'}>{t(`priority.${w.priority}`)}</Badge>}
                        <span className="text-xs text-muted">{t('queue.position', { position: i + 1 })}</span>
                        {editable && (
                          <>
                            <Select className="h-8 w-32 text-xs" aria-label={t('queue.priority')} value={w.priority} onChange={(e) => void update(w, { priority: e.target.value as QueuePriority })}>
                              {QUEUE_PRIORITIES.map((p) => (
                                <option key={p} value={p}>
                                  {t(`priority.${p}`)}
                                </option>
                              ))}
                            </Select>
                            <Button size="sm" variant="ghost" onClick={() => void update(w, { status: 'skipped' })}>
                              {t('queue.skip')}
                            </Button>
                          </>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}
      </DataState>
    </div>
  );
}
