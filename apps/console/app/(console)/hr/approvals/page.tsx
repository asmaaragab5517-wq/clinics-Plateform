'use client';

import { useState } from 'react';
import { Badge, Bdi, Button, PageHeader, Table } from '@hf/ui';
import { DataState, InlineError, Section, TextAreaField } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName, num } from '@/lib/format';
import { duration, fmtDay, type LeaveRequest, type PermissionRequest } from '@/lib/hr';

type Decision = { kind: 'leave-requests' | 'permission-requests'; id: string; approve: boolean; who: string; what: string };

/** Pending leave and hourly-permission requests for managers (hr:approve). Nobody decides their own request. */
export default function HrApprovalsPage() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const leave = useApi<LeaveRequest[]>('/hr/leave-requests?status=pending');
  const perms = useApi<PermissionRequest[]>('/hr/permission-requests?status=pending');
  const [decision, setDecision] = useState<Decision | null>(null);
  const actions = (kind: Decision['kind'], id: string, userId: string, who: string, what: string) =>
    userId === me.userId ? (
      <span className="text-xs text-muted">{t('hr.appr.own')}</span>
    ) : (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" onClick={() => setDecision({ kind, id, approve: true, who, what })}>
          {t('common.approve')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDecision({ kind, id, approve: false, who, what })}>
          {t('common.reject')}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.hrApprovals')} subtitle={t('hr.appr.subtitle')} />
      <Section title={t('hr.appr.leave')} actions={<Badge tone="warning">{leave.data?.length ?? 0}</Badge>}>
        <DataState loading={leave.loading} error={leave.error} data={leave.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('hr.person')}</th>
                  <th>{t('hr.leaveType')}</th>
                  <th>{t('common.from')}</th>
                  <th>{t('common.to')}</th>
                  <th>{t('hr.days')}</th>
                  <th>{t('form.reason')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const who = biName(r, locale);
                  const type = locale === 'en' ? r.type_name_en || r.type_name_ar || '' : r.type_name_ar || '';
                  return (
                    <tr key={r.id}>
                      <td>
                        <Bdi>{who}</Bdi>
                      </td>
                      <td>{type}</td>
                      <td className="num">{fmtDay(r.start_date)}</td>
                      <td className="num">{fmtDay(r.end_date)}</td>
                      <td className="num">{num(r.days)}</td>
                      <td className="text-xs">{r.reason ?? '—'}</td>
                      <td>{actions('leave-requests', r.id, r.user_id, who, t('hr.appr.leaveWhat', { type, from: fmtDay(r.start_date), to: fmtDay(r.end_date), n: num(r.days) }))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <Section title={t('hr.appr.perm')} actions={<Badge tone="warning">{perms.data?.length ?? 0}</Badge>}>
        <DataState loading={perms.loading} error={perms.error} data={perms.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('hr.person')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('hr.perm.kind')}</th>
                  <th>{t('hr.perm.time')}</th>
                  <th>{t('form.reason')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const who = biName(r, locale);
                  const time = `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Bdi>{who}</Bdi>
                      </td>
                      <td className="num">{fmtDay(r.work_date)}</td>
                      <td>{t(`hr.perm.${r.kind}`)}</td>
                      <td className="whitespace-nowrap">
                        <bdi className="num">{time}</bdi> · {duration(t, r.minutes)}
                      </td>
                      <td className="text-xs">{r.reason ?? '—'}</td>
                      <td>{actions('permission-requests', r.id, r.user_id, who, t('hr.appr.permWhat', { kind: t(`hr.perm.${r.kind}`), d: fmtDay(r.work_date), time }))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <DecideDialog
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={() => {
          leave.reload();
          perms.reload();
        }}
      />
    </div>
  );
}

function DecideDialog({ decision, onClose, onDone }: { decision: Decision | null; onClose: () => void; onDone: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setNote('');
    setError(null);
    onClose();
  };
  return (
    <Dialog open={!!decision} onClose={close} title={decision ? t(decision.approve ? 'hr.appr.approveTitle' : 'hr.appr.rejectTitle', { name: decision.who }) : ''}>
      {decision && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await post(`/hr/${decision.kind}/${decision.id}/decide`, { approve: decision.approve, note: note.trim() || undefined });
              toast(t(decision.approve ? 'hr.appr.approved' : 'hr.appr.rejected'));
              onDone();
              close();
            } catch (x) {
              setError(err(x));
              onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm">{decision.what}</p>
          <TextAreaField label={t('hr.appr.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <InlineError text={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={decision.approve ? 'primary' : 'danger'} disabled={busy}>
              {t(decision.approve ? 'common.approve' : 'common.reject')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
