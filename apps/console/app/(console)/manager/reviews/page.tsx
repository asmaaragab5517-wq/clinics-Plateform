'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { post, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  display_name: string;
  status: string;
  created_at: string;
  doctor_name: string;
  clinic_name: string;
}

/** FR-REV-2: moderation queue; only approved reviews are public (first name + initial). */
export default function ReviewsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [status, setStatus] = useState('pending');
  const q = useApi<Review[]>(`/reviews${qs({ status })}`);
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.reviews')} />
      <Section
        title={t('nav.reviews')}
        actions={
          <Select className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            {['pending', 'approved', 'rejected'].map((s) => (
              <option key={s} value={s}>
                {t(`appr.status.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('rev.rating')}</th>
                  <th>{t('rev.comment')}</th>
                  <th>{t('book.doctor')}</th>
                  <th>{t('rev.by')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <DateText value={r.created_at} locale={locale} />
                    </td>
                    <td>
                      <Badge tone={r.rating <= 2 ? 'danger' : r.rating >= 4 ? 'success' : 'warning'}>
                        <span className="num" aria-label={t('rev.stars', { n: r.rating })}>
                          {'★'.repeat(r.rating)}
                        </span>
                      </Badge>
                    </td>
                    <td className="max-w-md" dir="auto">
                      {r.comment}
                    </td>
                    <td>
                      <Bdi>{r.doctor_name}</Bdi> <span className="text-xs text-muted">· {r.clinic_name}</span>
                    </td>
                    <td>
                      <Bdi>{r.display_name}</Bdi>
                    </td>
                    <td>
                      {r.status === 'pending' && can('review:approve') && (
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => void a.run(() => post(`/reviews/${r.id}/moderate`, { approve: true })).then((x) => x && q.reload())}>
                            {t('rev.publish')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void a.run(() => post(`/reviews/${r.id}/moderate`, { approve: false })).then((x) => x && q.reload())}>
                            {t('common.reject')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
        <p className="mt-2 text-xs text-muted">{t('rev.lowHint')}</p>
      </Section>
    </div>
  );
}
