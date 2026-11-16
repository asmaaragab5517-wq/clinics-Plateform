'use client';

import { useState } from 'react';
import { CONSENT_TYPES } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, Input, PageHeader, Table, Tabs } from '@hf/ui';
import { DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch, post } from '@/lib/api';
import { useApi, useInterval } from '@/lib/hooks';

type Tab = 'consents' | 'requests' | 'breaches';

/** FR-PRV-1/4/5: consent versions, data subject requests with SLA, breach register with the 72-hour deadline. */
export default function PrivacyPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('requests');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.privacy')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'requests', label: t('prv.requests') },
          { value: 'consents', label: t('prv.versions') },
          { value: 'breaches', label: t('prv.breaches') },
        ]}
      />
      {tab === 'consents' && <Versions />}
      {tab === 'requests' && <Requests />}
      {tab === 'breaches' && <Breaches />}
    </div>
  );
}

function Versions() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<{ id: string; type: string; version: number; text_ar: string; text_en: string; published_at: string }[]>('/privacy/consent-versions');
  const [f, setF] = useState({ type: 'health_data', textAr: '', textEn: '' });
  const a = useAction();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('prv.versions')} className="xl:col-span-2">
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('consent.type')}</th>
                  <th>{t('prv.version')}</th>
                  <th>{t('prv.text')}</th>
                  <th>{t('prv.published')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>{t(`consent.${v.type}`)}</td>
                    <td className="num">v{v.version}</td>
                    <td className="max-w-md truncate" dir="rtl">
                      {v.text_ar}
                    </td>
                    <td>
                      <DateText value={v.published_at} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {can('privacy:create') && (
        <Section title={t('prv.publishVersion')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => post('/privacy/consent-versions', f));
              if (r) {
                setF({ ...f, textAr: '', textEn: '' });
                q.reload();
              }
            }}
          >
            <SelectField label={t('consent.type')} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={CONSENT_TYPES.map((c) => ({ value: c, label: t(`consent.${c}`) }))} />
            <TextAreaField label={t('prv.textAr')} value={f.textAr} onChange={(e) => setF({ ...f, textAr: e.target.value })} minLength={20} required dir="rtl" />
            <TextAreaField label={t('prv.textEn')} value={f.textEn} onChange={(e) => setF({ ...f, textEn: e.target.value })} dir="ltr" />
            <p className="text-xs text-muted">{t('prv.reconsentHint')}</p>
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('prv.publish')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}

function Requests() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<{ id: string; kind: string; status: string; details: string | null; due_at: string; overdue: boolean; mrn: string; patient_name: string; created_at: string }[]>('/privacy/data-requests');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [download, setDownload] = useState<string | null>(null);
  const a = useAction();
  const act = async (id: string, action: 'complete' | 'reject') => {
    const r = await a.run(() => post<{ download: string | null }>(`/privacy/data-requests/${id}/process`, { action, note: notes[id] || undefined }));
    if (r) {
      toast(t('common.saved'));
      setDownload(r.download);
      q.reload();
    }
  };
  return (
    <Section title={t('prv.requests')}>
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      {download && (
        <Alert tone="success">
          {t('prv.exportReady')}{' '}
          <a className="underline" href={download} target="_blank" rel="noopener noreferrer">
            {t('prv.download')}
          </a>
        </Alert>
      )}
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('rec.patient')}</th>
                <th>{t('prv.kind')}</th>
                <th>{t('prv.due')}</th>
                <th>{t('common.status')}</th>
                <th>{t('prv.details')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Bdi>{r.patient_name}</Bdi> <Bdi className="num text-xs text-muted">{r.mrn}</Bdi>
                  </td>
                  <td>{t(`prv.kinds.${r.kind}`)}</td>
                  <td>
                    <DateText value={r.due_at} locale={locale} /> {r.overdue && <Badge tone="danger">{t('prv.overdue')}</Badge>}
                  </td>
                  <td>
                    <Badge>{t(`prv.status.${r.status}`)}</Badge>
                  </td>
                  <td className="max-w-xs truncate" dir="auto">
                    {r.details}
                  </td>
                  <td>
                    {can('privacy:approve') && !['completed', 'rejected'].includes(r.status) && (
                      <div className="flex flex-wrap gap-1">
                        <Input className="h-8 w-32 text-xs" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder={t('appr.note')} aria-label={t('appr.note')} />
                        <Button size="sm" onClick={() => r.kind !== 'erasure' || window.confirm(t('prv.confirmErasure')) ? void act(r.id, 'complete') : undefined}>
                          {t('prv.complete')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void act(r.id, 'reject')}>
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
    </Section>
  );
}

interface Breach {
  id: string;
  title: string;
  description: string;
  detected_at: string;
  contained_at: string | null;
  reported_to_pdpc_at: string | null;
  subjects_notified_at: string | null;
  severity: string;
  affected_count: number | null;
  timeline: { at: string; event: string; by: string }[];
}

function Deadline({ b }: { b: Breach }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), 60_000);
  if (b.reported_to_pdpc_at) return <Badge tone="success">{t('prv.reported')}</Badge>;
  const due = new Date(b.detected_at).getTime() + 72 * 3600_000;
  const left = due - now;
  const h = Math.floor(Math.abs(left) / 3600_000);
  const m = Math.floor((Math.abs(left) % 3600_000) / 60_000);
  return left > 0 ? <Badge tone={left < 24 * 3600_000 ? 'warning' : 'primary'}>{t('prv.timeLeft', { h, m })}</Badge> : <Badge tone="danger">{t('prv.overdueBy', { h, m })}</Badge>;
}

function Breaches() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<Breach[]>('/privacy/breaches');
  const [f, setF] = useState({ title: '', description: '', detectedAt: '', severity: 'medium', affectedCount: '' });
  const a = useAction();
  const mark = (id: string, field: 'containedAt' | 'reportedToPdpcAt' | 'subjectsNotifiedAt') => void a.run(() => patch(`/privacy/breaches/${id}`, { [field]: new Date().toISOString(), note: field })).then((r) => r && q.reload());
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Section title={t('prv.breaches')} className="xl:col-span-2">
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <div className="flex flex-col gap-3">
              {rows.map((b) => (
                <article key={b.id} className="rounded-xl border border-border p-3 text-sm">
                  <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <strong dir="auto">{b.title}</strong>
                    <span className="flex gap-2">
                      <Badge tone={b.severity === 'critical' || b.severity === 'high' ? 'danger' : 'warning'}>{t(`prv.sev.${b.severity}`)}</Badge>
                      <Deadline b={b} />
                    </span>
                  </header>
                  <p dir="auto" className="text-muted">
                    {b.description}
                  </p>
                  <p className="mt-1 text-xs">
                    {t('prv.detected')}: <DateText value={b.detected_at} locale={locale} withTime /> {b.affected_count !== null && `· ${t('prv.affected', { n: b.affected_count })}`}
                  </p>
                  <ol className="mt-2 flex flex-col gap-0.5 border-s border-border ps-3 text-xs text-muted">
                    {b.timeline.map((e, i) => (
                      <li key={i}>
                        <DateText value={e.at} locale={locale} withTime /> · {t(`prv.event.${e.event}`) === `prv.event.${e.event}` ? e.event : t(`prv.event.${e.event}`)} · <Bdi>{e.by}</Bdi>
                      </li>
                    ))}
                  </ol>
                  {can('privacy:edit') && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!b.contained_at && <Button size="sm" variant="secondary" onClick={() => mark(b.id, 'containedAt')}>{t('prv.markContained')}</Button>}
                      {!b.reported_to_pdpc_at && <Button size="sm" onClick={() => mark(b.id, 'reportedToPdpcAt')}>{t('prv.markReported')}</Button>}
                      {!b.subjects_notified_at && <Button size="sm" variant="secondary" onClick={() => mark(b.id, 'subjectsNotifiedAt')}>{t('prv.markNotified')}</Button>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </DataState>
      </Section>
      {can('privacy:create') && (
        <Section title={t('prv.registerBreach')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => post('/privacy/breaches', { title: f.title, description: f.description, detectedAt: new Date(f.detectedAt).toISOString(), severity: f.severity, affectedCount: f.affectedCount ? Number(f.affectedCount) : undefined }));
              if (r) {
                setF({ title: '', description: '', detectedAt: '', severity: 'medium', affectedCount: '' });
                q.reload();
              }
            }}
          >
            <TextField label={t('prv.breachTitle')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} />
            <TextAreaField label={t('prv.description')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required minLength={10} />
            <TextField label={t('prv.detected')} type="datetime-local" value={f.detectedAt} onChange={(e) => setF({ ...f, detectedAt: e.target.value })} required />
            <SelectField label={t('prv.severity')} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} options={['low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: t(`prv.sev.${s}`) }))} />
            <TextField label={t('prv.affectedCount')} type="number" min={0} value={f.affectedCount} onChange={(e) => setF({ ...f, affectedCount: e.target.value })} />
            <p className="text-xs text-muted">{t('prv.deadlineHint')}</p>
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('prv.register')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}
