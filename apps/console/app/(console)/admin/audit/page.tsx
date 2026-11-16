'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, DateText, Input, PageHeader, Table, Tabs } from '@hf/ui';
import { DataState, Section, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { get, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName } from '@/lib/format';

interface Entry {
  seq: number;
  at: string;
  actor_type: string;
  actor_id: string | null;
  role: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  patient_id: string | null;
  clinic_id: string | null;
  ip: string | null;
  reason: string | null;
  details: unknown;
}

type Tab = 'log' | 'review';

/** FR-PRV-3 audit viewer with hash-chain verification; SEC-8 quarterly access review. */
export default function AuditPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('log');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.audit')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'log', label: t('aud.log') },
          { value: 'review', label: t('aud.accessReview') },
        ]}
      />
      {tab === 'log' ? <Log /> : <AccessReview />}
    </div>
  );
}

function Log() {
  const { t, locale } = useI18n();
  const [f, setF] = useState({ action: '', patientId: '', actorId: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const q = useApi<Entry[]>(`/audit${qs({ action: applied.action, patientId: applied.patientId, actorId: applied.actorId, from: applied.from ? new Date(applied.from).toISOString() : undefined, to: applied.to ? new Date(applied.to).toISOString() : undefined, limit: 300 })}`);
  const v = useAction();
  const [verify, setVerify] = useState<{ intact: boolean; firstBrokenSeq: number | null; entries: number } | null>(null);
  return (
    <Section
      title={t('aud.log')}
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={v.busy}
          onClick={async () => {
            const r = await v.run(() => get<{ intact: boolean; firstBrokenSeq: number | null; entries: number }>('/audit/verify'));
            if (r) setVerify(r);
          }}
        >
          {t('aud.verify')}
        </Button>
      }
    >
      {verify && <Alert tone={verify.intact ? 'success' : 'danger'}>{verify.intact ? t('aud.intact', { n: verify.entries }) : t('aud.broken', { seq: verify.firstBrokenSeq ?? '?' })}</Alert>}
      {v.error && <Alert tone="danger">{v.error}</Alert>}
      <form
        className="my-3 grid gap-2 md:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <Input placeholder={t('aud.action')} aria-label={t('aud.action')} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} dir="ltr" />
        <Input placeholder={t('aud.patientId')} aria-label={t('aud.patientId')} value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })} dir="ltr" />
        <Input placeholder={t('aud.actorId')} aria-label={t('aud.actorId')} value={f.actorId} onChange={(e) => setF({ ...f, actorId: e.target.value })} dir="ltr" />
        <Input type="datetime-local" aria-label={t('common.from')} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="datetime-local" aria-label={t('common.to')} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Button type="submit">{t('common.search')}</Button>
      </form>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('common.date')}</th>
                  <th>{t('aud.actor')}</th>
                  <th>{t('aud.action')}</th>
                  <th>{t('aud.entity')}</th>
                  <th>{t('aud.patient')}</th>
                  <th>{t('aud.ip')}</th>
                  <th>{t('form.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.seq}>
                    <td className="num text-xs">{r.seq}</td>
                    <td className="whitespace-nowrap text-xs">
                      <DateText value={r.at} locale={locale} withTime />
                    </td>
                    <td className="text-xs">
                      {r.role ? t(`role.${r.role}`) : r.actor_type}
                      <Bdi className="num block text-muted">{r.actor_id?.slice(0, 8)}</Bdi>
                    </td>
                    <td>
                      <Bdi className="num text-xs">{r.action}</Bdi>
                    </td>
                    <td className="text-xs">
                      <Bdi>{`${r.entity ?? ''} ${r.entity_id?.slice(0, 8) ?? ''}`}</Bdi>
                    </td>
                    <td>
                      <Bdi className="num text-xs">{r.patient_id?.slice(0, 8)}</Bdi>
                    </td>
                    <td>
                      <Bdi className="num text-xs">{r.ip}</Bdi>
                    </td>
                    <td className="text-xs" dir="auto">
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </DataState>
    </Section>
  );
}

function AccessReview() {
  const { t, locale } = useI18n();
  const q = useApi<{ id: string; name_ar: string; email: string | null; status: string; mfa_enrolled: boolean; last_login_at: string | null; memberships: { role: string | null; clinicId: string | null }[]; actions_90d: number }[]>('/audit/access-review');
  return (
    <Section title={t('aud.accessReview')}>
      <p className="mb-2 text-sm text-muted">{t('aud.reviewHint')}</p>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('staff.name')}</th>
                <th>{t('staff.roles')}</th>
                <th>{t('staff.mfa')}</th>
                <th>{t('staff.lastLogin')}</th>
                <th>{t('aud.actions90')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={u.status === 'active' && (!u.last_login_at || Date.now() - new Date(u.last_login_at).getTime() > 90 * 86400_000) ? 'bg-warning/10' : ''}>
                  <td>
                    <Bdi>{biName(u, locale)}</Bdi>
                    <Bdi className="block text-xs text-muted">{u.email}</Bdi>
                  </td>
                  <td className="text-xs">{u.memberships.filter((m) => m.role).map((m) => t(`role.${m.role}`)).join(t('common.listSep'))}</td>
                  <td>{u.mfa_enrolled ? <Badge tone="success">{t('common.yes')}</Badge> : <Badge tone="danger">{t('common.no')}</Badge>}</td>
                  <td>{u.last_login_at ? <DateText value={u.last_login_at} locale={locale} /> : '—'}</td>
                  <td className="num">{u.actions_90d}</td>
                  <td>
                    <Badge>{t(`staff.status.${u.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}
