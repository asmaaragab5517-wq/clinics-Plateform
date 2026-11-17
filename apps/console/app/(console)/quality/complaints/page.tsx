'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, SelectField, TextAreaField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import { COMPLAINT_STATUSES, ComplaintForm } from '@/components/quality';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Complaint {
  id: string;
  clinic_id: string;
  clinic_name: string;
  patient_id: string | null;
  channel: string;
  category: string;
  description: string;
  status: (typeof COMPLAINT_STATUSES)[number];
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

const TONE = { open: 'danger', in_progress: 'warning', resolved: 'success', closed: 'neutral' } as const;

/** Complaints register (patient voice): triage, resolution notes and closure. */
export default function ComplaintsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const q = useApi<Complaint[]>(`/complaints${qs({ status })}`);
  const [edit, setEdit] = useState<Complaint | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.complaints')} />
      <Section
        title={t('quality.complaints')}
        actions={
          <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            <option value="">{t('cash.allStatuses')}</option>
            {COMPLAINT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`complaint.status.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('shell.clinic')}</th>
                  <th>{t('quality.category')}</th>
                  <th>{t('quality.complaintText')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <DateText value={c.created_at} locale={locale} withTime />
                      <span className="block text-xs text-muted">{t(`complaint.chan.${c.channel}`)}</span>
                    </td>
                    <td>
                      <Bdi>{c.clinic_name}</Bdi>
                    </td>
                    <td>{t(`complaint.cat.${c.category}`)}</td>
                    <td className="max-w-md">
                      <p dir="auto" className="line-clamp-3 whitespace-pre-wrap">
                        {c.description}
                      </p>
                      {c.resolution && (
                        <p dir="auto" className="mt-1 text-xs text-success">
                          {t('quality.resolution')}: {c.resolution}
                        </p>
                      )}
                    </td>
                    <td>
                      <Badge tone={TONE[c.status]}>{t(`complaint.status.${c.status}`)}</Badge>
                    </td>
                    <td>
                      {can('quality:edit') && c.status !== 'closed' && (
                        <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>
                          {t('quality.update')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {can('quality:create') && (
        <Section title={t('quality.logComplaint')}>
          <ComplaintForm onDone={q.reload} />
        </Section>
      )}
      <UpdateComplaint c={edit} onClose={() => setEdit(null)} onDone={q.reload} />
    </div>
  );
}

function UpdateComplaint({ c, onClose, onDone }: { c: Complaint | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('in_progress');
  const [resolution, setResolution] = useState('');
  const a = useAction();
  return (
    <Dialog open={!!c} onClose={onClose} title={t('quality.updateComplaint')}>
      {c && (
        <form
          key={c.id}
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if ((status === 'resolved' || status === 'closed') && !resolution.trim() && !c.resolution) return a.setError(t('quality.resolutionRequired'));
            const r = await a.run(() => patch(`/complaints/${c.id}`, { status, resolution: resolution.trim() || undefined }));
            if (r) {
              toast(t('common.saved'));
              setResolution('');
              onDone();
              onClose();
            }
          }}
        >
          <p dir="auto" className="rounded-lg bg-bg p-2 text-sm">
            {c.description}
          </p>
          <SelectField label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)} options={(['in_progress', 'resolved', 'closed'] as const).map((s) => ({ value: s, label: t(`complaint.status.${s}`) }))} />
          <TextAreaField label={t('quality.resolution')} value={resolution} placeholder={c.resolution ?? ''} onChange={(e) => setResolution(e.target.value)} maxLength={5000} rows={3} dir="auto" />
          <p className="text-xs text-muted">{t('quality.webhookNote')}</p>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={a.busy}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
