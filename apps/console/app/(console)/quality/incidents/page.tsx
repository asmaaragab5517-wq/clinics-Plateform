'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, PageHeader, Select, Table } from '@hf/ui';
import { DataState, Section, SelectField, TextAreaField, useAction } from '@/components/common';
import { Dialog } from '@/components/dialog';
import { useI18n } from '@/components/i18n';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, IncidentForm } from '@/components/quality';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Incident {
  id: string;
  clinic_id: string;
  clinic_name: string;
  patient_id: string | null;
  category: string;
  severity: (typeof INCIDENT_SEVERITIES)[number];
  description: string;
  occurred_at: string;
  actions_taken: string | null;
  status: (typeof INCIDENT_STATUSES)[number];
  created_at: string;
}

const SEV_TONE: Record<Incident['severity'], 'neutral' | 'warning' | 'danger'> = { near_miss: 'neutral', no_harm: 'neutral', minor: 'warning', moderate: 'warning', severe: 'danger', death: 'danger' };
const STATUS_TONE = { reported: 'danger', investigating: 'warning', closed: 'success' } as const;

/** Patient-safety incident register: investigation and closure (closing emits `incident.closed`). */
export default function IncidentsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<Incident[]>('/incidents');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Incident | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.incidents')} />
      <Section
        title={t('quality.incidents')}
        actions={
          <Select className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
            <option value="">{t('cash.allStatuses')}</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`incident.status.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        <DataState loading={q.loading} error={q.error} data={q.data?.filter((i) => !status || i.status === status)} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('quality.occurredAt')}</th>
                  <th>{t('shell.clinic')}</th>
                  <th>{t('quality.category')}</th>
                  <th>{t('quality.severity')}</th>
                  <th>{t('quality.whatHappened')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <DateText value={i.occurred_at} locale={locale} withTime />
                    </td>
                    <td>
                      <Bdi>{i.clinic_name}</Bdi>
                    </td>
                    <td>{t(`incident.cat.${i.category}`)}</td>
                    <td>
                      <Badge tone={SEV_TONE[i.severity]}>{t(`incident.sev.${i.severity}`)}</Badge>
                    </td>
                    <td className="max-w-md">
                      <p dir="auto" className="line-clamp-3 whitespace-pre-wrap">
                        {i.description}
                      </p>
                      {i.actions_taken && (
                        <p dir="auto" className="mt-1 text-xs text-muted">
                          {t('quality.actionsTaken')}: {i.actions_taken}
                        </p>
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[i.status]}>{t(`incident.status.${i.status}`)}</Badge>
                    </td>
                    <td>
                      {can('quality:edit') && i.status !== 'closed' && (
                        <Button size="sm" variant="secondary" onClick={() => setEdit(i)}>
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
        <Section title={t('quality.reportIncident')}>
          <IncidentForm onDone={q.reload} />
        </Section>
      )}
      <UpdateIncident i={edit} onClose={() => setEdit(null)} onDone={q.reload} />
    </div>
  );
}

function UpdateIncident({ i, onClose, onDone }: { i: Incident | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('investigating');
  const [actions, setActions] = useState('');
  const a = useAction();
  return (
    <Dialog open={!!i} onClose={onClose} title={t('quality.updateIncident')}>
      {i && (
        <form
          key={i.id}
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await a.run(() => patch(`/incidents/${i.id}`, { status, actionsTaken: actions.trim() || undefined }));
            if (r) {
              toast(t('common.saved'));
              setActions('');
              onDone();
              onClose();
            }
          }}
        >
          <p dir="auto" className="rounded-lg bg-bg p-2 text-sm">
            {i.description}
          </p>
          <SelectField label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)} options={(['investigating', 'closed'] as const).map((s) => ({ value: s, label: t(`incident.status.${s}`) }))} />
          <TextAreaField label={t('quality.actionsTaken')} value={actions} placeholder={i.actions_taken ?? ''} onChange={(e) => setActions(e.target.value)} maxLength={5000} rows={3} dir="auto" />
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
