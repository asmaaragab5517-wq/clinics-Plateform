'use client';

import { Alert, Badge, Button, DateText, PageHeader, Table } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Access {
  id: string;
  reason: string;
  hours: number;
  status: 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired';
  starts_at: string | null;
  ends_at: string | null;
  decided_at: string | null;
  created_at: string;
}

const TONE = { requested: 'warning', approved: 'success', rejected: 'danger', revoked: 'neutral', expired: 'neutral' } as const;

/** BR-20 support access: HealthFlow staff get a time-boxed, read-only window only after the owner approves. */
export default function SupportAccessPage() {
  const { t, locale } = useI18n();
  const { can, hasRole } = useSession();
  const toast = useToast();
  const q = useApi<Access[]>('/support-access');
  const a = useAction();
  const owner = hasRole('owner');
  const now = Date.now();
  async function decide(x: Access, approve: boolean) {
    const r = await a.run(() => post(`/support-access/${x.id}/decision`, { approve }));
    if (r) {
      toast(approve ? t('support.approved') : t('support.rejected'));
      q.reload();
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.supportAccess')} subtitle={t('support.subtitle')} />
      <Alert tone="info">{t('support.explain')}</Alert>
      {!owner && <Alert tone="warning">{t('support.ownerOnly')}</Alert>}
      <Section title={t('support.requests')}>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('support.reason')}</th>
                  <th>{t('support.duration')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('support.window')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const live = x.status === 'approved' && !!x.ends_at && new Date(x.ends_at).getTime() > now;
                  const status = x.status === 'approved' && !live ? 'expired' : x.status;
                  return (
                    <tr key={x.id}>
                      <td>
                        <DateText value={x.created_at} locale={locale} withTime />
                      </td>
                      <td className="max-w-md" dir="auto">
                        {x.reason}
                      </td>
                      <td className="num">{t('support.hours', { n: x.hours })}</td>
                      <td>
                        <Badge tone={TONE[status]}>{t(`support.status.${status}`)}</Badge>
                      </td>
                      <td className="text-xs">
                        {x.starts_at && <DateText value={x.starts_at} locale={locale} withTime />}
                        {x.ends_at && (
                          <>
                            {' → '}
                            <DateText value={x.ends_at} locale={locale} withTime />
                          </>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {x.status === 'requested' && owner && (
                            <>
                              <Button size="sm" disabled={a.busy} onClick={() => void decide(x, true)}>
                                {t('common.approve')}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={a.busy} onClick={() => void decide(x, false)}>
                                {t('common.reject')}
                              </Button>
                            </>
                          )}
                          {live && can('settings:edit') && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={a.busy}
                              onClick={async () => {
                                const r = await a.run(() => post(`/support-access/${x.id}/revoke`));
                                if (r) {
                                  toast(t('support.revoked'));
                                  q.reload();
                                }
                              }}
                            >
                              {t('support.revoke')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
    </div>
  );
}
