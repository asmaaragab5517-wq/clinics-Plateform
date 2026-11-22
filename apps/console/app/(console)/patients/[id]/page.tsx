'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { CONSENT_TYPES, formatMoney, type AppointmentStatus } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, Money, PageHeader, StatusBadge, Table, Tabs } from '@hf/ui';
import { Check, DataState, ErrorAlert, Loading, ReasonDialog, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { CustomFieldInputs, CustomFieldValue, customFieldsPayload, fieldLabel, useCustomFields, validateCustomFields, type CustomValues } from '@/components/custom-fields';
import { PatientDentalTab } from '@/components/dental-chart';
import { useI18n } from '@/components/i18n';
import { PatientCoverages } from '@/components/insurance';
import { PatientSearch } from '@/components/patient-search';
import { SignaturePad } from '@/components/signature-pad';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, get, patch, post, upload } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ageFrom, isoDate, num, patientName } from '@/lib/format';
import type { BillRow, EncounterListRow, PatientRow } from '@/lib/types';

interface PatientDetail {
  id: string;
  mrn: string;
  first_name_ar: string;
  father_name_ar: string;
  grandfather_name_ar: string;
  family_name_ar: string;
  name_en: string | null;
  date_of_birth: string;
  gender: 'male' | 'female';
  email: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  marital_status: string | null;
  occupation: string | null;
  emergency_contact: { name: string; phone: string; relation: string } | null;
  nationality: string | null;
  merged_into_id: string | null;
  anonymised_at: string | null;
  nationalId: string | null;
  contacts: { id: string; phone: string; is_primary: boolean }[];
  allergies: { id: string; text: string; severity: string | null; ingredient: string | null }[];
  guardian: PatientRow | null;
  consents: { id: string; type: string; granted: boolean; created_at: string; version_id: string; channel: string; signed: boolean }[];
  custom_fields: Record<string, unknown> | null;
}

type Tab = 'overview' | 'timeline' | 'encounters' | 'history' | 'dental' | 'documents' | 'consents' | 'insurance' | 'messages' | 'billing' | 'merge';

export default function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { can } = useSession();
  const p = useApi<PatientDetail>(`/patients/${id}`);
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: 'overview', label: t('pat.tab.overview'), show: true },
    { value: 'timeline', label: t('pat.tab.timeline'), show: true },
    { value: 'encounters', label: t('pat.tab.encounters'), show: true },
    { value: 'history', label: t('pat.tab.history'), show: can('emr:view') },
    { value: 'dental', label: t('pat.tab.dental'), show: can('emr:view') },
    { value: 'documents', label: t('pat.tab.documents'), show: can('emr:view') },
    { value: 'consents', label: t('pat.tab.consents'), show: true },
    { value: 'insurance', label: t('pat.tab.insurance'), show: true },
    { value: 'messages', label: t('pat.tab.messages'), show: can('message:view') },
    { value: 'billing', label: t('pat.tab.billing'), show: can('bill:view') },
    { value: 'merge', label: t('pat.tab.merge'), show: can('patient:edit') },
  ];
  return (
    <DataState loading={p.loading} error={p.error} data={p.data}>
      {(pt) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={patientName(pt, locale) || pt.mrn}
            subtitle={`${pt.mrn} · ${t(`patient.${pt.gender}`)} · ${t('pat.age', { n: ageFrom(pt.date_of_birth) ?? '—' })}`}
            actions={
              <>
                {can('appointment:create') && (
                  <Link href="/reception" className="inline-flex h-10 items-center rounded-xl border border-border px-4 hover:bg-bg">
                    {t('nav.reception')}
                  </Link>
                )}
                {can('bill:create') && (
                  <Link href={`/cashier?patientId=${pt.id}`} className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-primary-fg">
                    {t('rec.takePayment')}
                  </Link>
                )}
              </>
            }
          />
          {pt.merged_into_id && (
            <Alert tone="warning">
              {t('pat.mergedInto')}{' '}
              <Link className="underline" href={`/patients/${pt.merged_into_id}`}>
                {t('pat.openTarget')}
              </Link>
            </Alert>
          )}
          {pt.allergies.length > 0 && (
            <div role="alert" className="rounded-xl border-2 border-danger bg-danger/10 p-3 text-danger">
              <strong>{t('patient.allergies')}:</strong>{' '}
              {pt.allergies.map((a) => (
                <span key={a.id} className="me-3">
                  <Bdi>{a.text}</Bdi>
                  {a.severity && ` (${t(`severity.${a.severity}`)})`}
                </span>
              ))}
            </div>
          )}
          <Tabs<Tab> value={tab} onChange={setTab} items={tabs.filter((x) => x.show)} />
          {tab === 'overview' && <Overview pt={pt} onSaved={p.reload} />}
          {tab === 'timeline' && <Timeline id={id} />}
          {tab === 'encounters' && <Encounters id={id} />}
          {tab === 'history' && <History id={id} />}
          {tab === 'dental' && <PatientDentalTab patientId={id} />}
          {tab === 'documents' && <Documents id={id} />}
          {tab === 'consents' && <Consents pt={pt} onSaved={p.reload} />}
          {tab === 'insurance' && <PatientCoverages patientId={pt.id} />}
          {tab === 'messages' && <Messages id={id} />}
          {tab === 'billing' && <Billing id={id} />}
          {tab === 'merge' && <Merge pt={pt} />}
        </div>
      )}
    </DataState>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 text-sm last:border-b-0">
      <dt className="text-muted">{k}</dt>
      <dd className="text-end">{v || '—'}</dd>
    </div>
  );
}

function Overview({ pt, onSaved }: { pt: PatientDetail; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ email: pt.email ?? '', address: pt.address ?? '', occupation: pt.occupation ?? '', nameEn: pt.name_en ?? '', phones: pt.contacts.map((c) => c.phone).join(', '), maritalStatus: pt.marital_status ?? '', ecName: pt.emergency_contact?.name ?? '', ecPhone: pt.emergency_contact?.phone ?? '', ecRelation: pt.emergency_contact?.relation ?? '' });
  const a = useAction();
  const { defs: cfDefs } = useCustomFields();
  const [custom, setCustom] = useState<CustomValues>(pt.custom_fields ?? {});
  const [cfErrors, setCfErrors] = useState<Record<string, string>>({});
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('pat.demographics')} actions={can('patient:edit') && !pt.anonymised_at ? <Button size="sm" variant="secondary" onClick={() => setEdit((x) => !x)}>{edit ? t('common.cancel') : t('common.edit')}</Button> : null}>
        {!edit ? (
          <dl>
            <Row k={t('pat.nameAr')} v={<Bdi>{patientName(pt, 'ar')}</Bdi>} />
            <Row k={t('pat.nameEn')} v={pt.name_en && <Bdi>{pt.name_en}</Bdi>} />
            <Row k={t('patient.mrn')} v={<Bdi className="num">{pt.mrn}</Bdi>} />
            <Row k={t('patient.nationalId')} v={pt.nationalId && <Bdi className="num">{pt.nationalId}</Bdi>} />
            <Row k={t('patient.dob')} v={<span className="num">{isoDate(pt.date_of_birth)}</span>} />
            <Row k={t('patient.gender')} v={t(`patient.${pt.gender}`)} />
            <Row k={t('pat.phones')} v={pt.contacts.map((c) => <Bdi key={c.id} className="num block">{c.phone}{c.is_primary ? ` (${t('pat.primary')})` : ''}</Bdi>)} />
            <Row k={t('pat.email')} v={pt.email && <Bdi>{pt.email}</Bdi>} />
            <Row k={t('pat.governorate')} v={[pt.governorate, pt.city].filter(Boolean).join(' / ')} />
            <Row k={t('pat.address')} v={pt.address && <Bdi>{pt.address}</Bdi>} />
            <Row k={t('pat.marital')} v={pt.marital_status && t(`pat.maritalStatus.${pt.marital_status}`)} />
            <Row k={t('pat.occupation')} v={pt.occupation} />
            <Row k={t('pat.emergency')} v={pt.emergency_contact && <Bdi>{`${pt.emergency_contact.name} · ${pt.emergency_contact.phone} · ${pt.emergency_contact.relation}`}</Bdi>} />
            <Row k={t('family.guardian')} v={pt.guardian && <Link className="underline" href={`/patients/${pt.guardian.id}`}><Bdi>{patientName(pt.guardian, locale)}</Bdi></Link>} />
            {cfDefs.map((d) => (
              <Row key={d.id} k={fieldLabel(d, locale)} v={<CustomFieldValue def={d} value={pt.custom_fields?.[d.key]} patientId={pt.id} />} />
            ))}
          </dl>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const phones = f.phones.split(/[,\u060C]/).map((x) => x.trim()).filter(Boolean);
              const ce = validateCustomFields(cfDefs, custom, t);
              setCfErrors(ce);
              if (Object.keys(ce).length) return;
              const customFields = customFieldsPayload(cfDefs, custom);
              const ok = await a.run(() =>
                patch(`/patients/${pt.id}`, {
                  email: f.email.trim() || undefined,
                  address: f.address.trim() || undefined,
                  occupation: f.occupation.trim() || undefined,
                  nameEn: f.nameEn.trim() || undefined,
                  maritalStatus: f.maritalStatus || undefined,
                  phones: phones.length ? phones.map((n, i) => ({ number: n, primary: i === 0 })) : undefined,
                  emergencyContact: f.ecName && f.ecPhone ? { name: f.ecName, phone: f.ecPhone, relation: f.ecRelation } : undefined,
                  customFields: Object.keys(customFields).length ? customFields : undefined,
                }),
              );
              if (ok) {
                toast(t('common.saved'));
                setEdit(false);
                onSaved();
              }
            }}
          >
            <TextField label={t('pat.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" />
            <TextField label={t('pat.phones')} hint={t('pat.phonesHint')} value={f.phones} onChange={(e) => setF({ ...f, phones: e.target.value })} dir="ltr" />
            <TextField label={t('pat.email')} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" />
            <TextField label={t('pat.address')} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
            <SelectField label={t('pat.marital')} value={f.maritalStatus} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, maritalStatus: e.target.value })} options={['single', 'married', 'divorced', 'widowed'].map((m) => ({ value: m, label: t(`pat.maritalStatus.${m}`) }))} />
            <TextField label={t('pat.occupation')} value={f.occupation} onChange={(e) => setF({ ...f, occupation: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <TextField label={t('pat.ecName')} value={f.ecName} onChange={(e) => setF({ ...f, ecName: e.target.value })} />
              <TextField label={t('pat.ecPhone')} value={f.ecPhone} onChange={(e) => setF({ ...f, ecPhone: e.target.value })} dir="ltr" />
              <TextField label={t('pat.ecRelation')} value={f.ecRelation} onChange={(e) => setF({ ...f, ecRelation: e.target.value })} />
            </div>
            <CustomFieldInputs defs={cfDefs} values={custom} onChange={setCustom} errors={cfErrors} patientId={pt.id} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('common.save')}
            </Button>
          </form>
        )}
      </Section>
      <Packages id={pt.id} />
    </div>
  );
}

function Packages({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const q = useApi<{ id: string; name_ar: string; name_en: string; sessions_total: number; sessions_used: number; expires_on: string }[]>(can('bill:view') ? `/patients/${id}/packages` : null);
  if (!can('bill:view')) return null;
  return (
    <Section title={t('pat.packages')}>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between rounded-lg border border-border p-2">
                <span>{locale === 'en' ? r.name_en || r.name_ar : r.name_ar}</span>
                <span className="text-muted">
                  {t('pat.sessionsLeft', { n: r.sessions_total - r.sessions_used, total: r.sessions_total })} · <span className="num">{isoDate(r.expires_on)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </Section>
  );
}

interface TimelineItem {
  kind: 'appointment' | 'bill' | 'payment' | 'message' | 'document' | 'encounter';
  id: string;
  at: string;
  status: string;
  data: Record<string, unknown>;
}

function Timeline({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const q = useApi<TimelineItem[]>(`/patients/${id}/timeline`);
  return (
    <Section title={t('pat.tab.timeline')}>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(items) => (
          <ol className="relative flex flex-col gap-3 border-s border-border ps-4">
            {items.map((i) => (
              <li key={`${i.kind}-${i.id}`} className="text-sm">
                <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{t(`timeline.${i.kind}`)}</Badge>
                  <DateText value={i.at} locale={locale} withTime />
                  {i.kind === 'appointment' ? <StatusBadge status={i.status as AppointmentStatus} locale={locale} /> : <Badge>{t(`state.${i.status}`)}</Badge>}
                </div>
                <p className="mt-1 text-muted">
                  {i.kind === 'appointment' && <Bdi>{`${String(i.data.doctor ?? '')} · ${String(i.data.ref ?? '')}`}</Bdi>}
                  {i.kind === 'bill' && (
                    <>
                      <Bdi className="num">{String(i.data.number ?? t('bill.draft'))}</Bdi> · <Money value={num(i.data.total)} locale={locale} />
                    </>
                  )}
                  {i.kind === 'payment' && (
                    <>
                      {t(`method.${String(i.data.method)}`)} · <Money value={num(i.data.amount)} locale={locale} /> · <Bdi className="num">{String(i.data.receipt ?? '')}</Bdi>
                    </>
                  )}
                  {i.kind === 'message' && `${t(`event.${String(i.data.event)}`)} · ${String(i.data.channel)}`}
                  {i.kind === 'document' && <Bdi>{String(i.data.title ?? '')}</Bdi>}
                  {i.kind === 'encounter' && (
                    <Link className="underline" href={`/doctor/encounters/${i.id}`}>
                      {((i.data.diagnoses as { code: string }[] | null) ?? []).map((d) => d.code).join(', ') || t('pat.openEncounter')}
                    </Link>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DataState>
    </Section>
  );
}

function BreakGlass({ id, onGranted }: { id: string; onGranted: () => void }) {
  const { t } = useI18n();
  const { hasRole } = useSession();
  const [reason, setReason] = useState('');
  const a = useAction();
  if (!hasRole('doctor', 'nurse', 'clinic_manager')) return <Alert tone="warning">{t('pat.emrDenied')}</Alert>;
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-warning/40 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await a.run(() => post<{ expires_at: string }>(`/patients/${id}/break-glass`, { reason }));
        if (r) onGranted();
      }}
    >
      <Alert tone="warning">{t('pat.breakGlassIntro')}</Alert>
      <TextAreaField label={t('pat.breakGlassReason')} value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} required />
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <Button type="submit" variant="danger" disabled={a.busy || reason.trim().length < 10}>
        {t('pat.breakGlass')}
      </Button>
    </form>
  );
}

function Encounters({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const q = useApi<EncounterListRow[]>(`/patients/${id}/encounters`);
  const denied = q.error instanceof ApiError && q.error.status === 403;
  return (
    <Section title={t('pat.tab.encounters')}>
      {denied ? (
        <BreakGlass id={id} onGranted={q.reload} />
      ) : (
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('book.doctor')}</th>
                  <th>{t('shell.clinic')}</th>
                  <th>{t('emr.chiefComplaint')}</th>
                  <th>{t('emr.diagnoses')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link className="underline" href={`/doctor/encounters/${e.id}`}>
                        <DateText value={e.created_at} locale={locale} />
                      </Link>
                    </td>
                    <td>
                      <Bdi>{e.doctor_name}</Bdi>
                    </td>
                    <td>
                      <Bdi>{e.clinic_name}</Bdi>
                    </td>
                    <td className="max-w-xs truncate" dir="auto">
                      {e.chief_complaint}
                    </td>
                    <td className="num">{e.diagnoses.map((d) => d.code).join(', ')}</td>
                    <td>
                      <Badge tone={e.status === 'signed' ? 'success' : 'warning'}>{t(`enc.status.${e.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      )}
    </Section>
  );
}

interface HistoryItem {
  id: string;
  kind: string;
  text: string;
  severity: string | null;
  ingredient: string | null;
  since: string | null;
  is_active: boolean;
}

const HISTORY_KINDS = ['allergy', 'chronic', 'surgery', 'medication', 'family', 'social', 'immunisation'];

function History({ id }: { id: string }) {
  const { t } = useI18n();
  const { can } = useSession();
  const q = useApi<HistoryItem[]>(`/patients/${id}/history`);
  const [f, setF] = useState({ kind: 'allergy', text: '', severity: '', ingredient: '', since: '' });
  const a = useAction();
  const denied = q.error instanceof ApiError && q.error.status === 403;
  if (denied) return <BreakGlass id={id} onGranted={q.reload} />;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title={t('pat.tab.history')} className="lg:col-span-2">
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <div className="flex flex-col gap-3">
              {HISTORY_KINDS.filter((k) => rows.some((r) => r.kind === k)).map((k) => (
                <div key={k}>
                  <h3 className="mb-1 text-sm font-bold">{t(`history.${k}`)}</h3>
                  <ul className="flex flex-col gap-1">
                    {rows
                      .filter((r) => r.kind === k)
                      .map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1 text-sm">
                          <span className={r.is_active ? '' : 'text-muted line-through'}>
                            <Bdi>{r.text}</Bdi>
                            {r.severity && ` · ${t(`severity.${r.severity}`)}`}
                            {r.ingredient && <span className="text-xs text-muted"> ({r.ingredient})</span>}
                            {r.since && <span className="num text-xs text-muted"> · {isoDate(r.since)}</span>}
                          </span>
                          {can('emr:edit') && (
                            <Button size="sm" variant="ghost" onClick={() => void a.run(() => patch(`/patients/${id}/history/${r.id}`, { isActive: !r.is_active })).then(q.reload)}>
                              {r.is_active ? t('history.deactivate') : t('history.reactivate')}
                            </Button>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </DataState>
      </Section>
      {can('emr:create') && (
        <Section title={t('history.add')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await a.run(() => post(`/patients/${id}/history`, { kind: f.kind, text: f.text, severity: f.severity || undefined, ingredient: f.ingredient || undefined, since: f.since || undefined }));
              if (r) {
                setF({ ...f, text: '', ingredient: '', since: '' });
                q.reload();
              }
            }}
          >
            <SelectField label={t('history.kind')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={HISTORY_KINDS.map((k) => ({ value: k, label: t(`history.${k}`) }))} />
            <TextField label={t('history.text')} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} required dir="auto" />
            {(f.kind === 'allergy' || f.kind === 'medication') && <TextField label={t('history.ingredient')} hint={t('history.ingredientHint')} value={f.ingredient} onChange={(e) => setF({ ...f, ingredient: e.target.value })} dir="ltr" />}
            {f.kind === 'allergy' && <SelectField label={t('history.severity')} value={f.severity} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, severity: e.target.value })} options={['mild', 'moderate', 'severe'].map((s) => ({ value: s, label: t(`severity.${s}`) }))} />}
            <TextField label={t('history.since')} type="date" value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('common.add')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}

function Documents({ id }: { id: string }) {
  const { t, locale, err } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<{ id: string; title: string; kind: string; mime: string; size_bytes: number; patient_provided: boolean; created_at: string }[]>(`/patients/${id}/documents`);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('report');
  const a = useAction();
  const denied = q.error instanceof ApiError && q.error.status === 403;
  if (denied) return <BreakGlass id={id} onGranted={q.reload} />;
  async function open(docId: string) {
    try {
      const r = await get<{ url: string }>(`/documents/${docId}/url`);
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(err(e), 'danger');
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title={t('pat.tab.documents')} className="lg:col-span-2">
        <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('doc.title')}</th>
                  <th>{t('doc.kind')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('doc.size')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Bdi>{d.title}</Bdi> {d.patient_provided && <Badge tone="warning">{t('doc.patientProvided')}</Badge>}
                    </td>
                    <td>{t(`doc.kinds.${d.kind}`)}</td>
                    <td>
                      <DateText value={d.created_at} locale={locale} />
                    </td>
                    <td className="num">{Math.ceil(d.size_bytes / 1024)} KB</td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => void open(d.id)}>
                        {t('doc.open')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      {can('emr:create') && (
        <Section title={t('doc.upload')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return;
              if (file.size > 25 * 1024 * 1024) {
                a.setError(t('err.file_too_large'));
                return;
              }
              const fd = new FormData();
              fd.set('file', file);
              fd.set('title', title || file.name);
              fd.set('kind', kind);
              const r = await a.run(() => upload(`/patients/${id}/documents`, fd));
              if (r) {
                toast(t('doc.uploaded'));
                setFile(null);
                setTitle('');
                q.reload();
              }
            }}
          >
            <TextField label={t('doc.file')} type="file" accept="application/pdf,image/jpeg,image/png,image/heic,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} hint={t('doc.limits')} required />
            <TextField label={t('doc.title')} value={title} onChange={(e) => setTitle(e.target.value)} />
            <SelectField label={t('doc.kind')} value={kind} onChange={(e) => setKind(e.target.value)} options={['report', 'result', 'imaging', 'referral', 'other'].map((k) => ({ value: k, label: t(`doc.kinds.${k}`) }))} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy || !file}>
              {t('doc.upload')}
            </Button>
          </form>
        </Section>
      )}
    </div>
  );
}

function Consents({ pt, onSaved }: { pt: PatientDetail; onSaved: () => void }) {
  const { t, locale, err } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const current = Object.fromEntries(pt.consents.map((c) => [c.type, c.granted]));
  const [v, setV] = useState<Record<string, boolean>>(Object.fromEntries(CONSENT_TYPES.map((c) => [c, !!current[c]])));
  const [signature, setSignature] = useState<string | null>(null);
  const [sigKey, setSigKey] = useState(0);
  const a = useAction();
  return (
    <Section title={t('pat.tab.consents')}>
      <div className="flex flex-col gap-3">
        <Table>
          <thead>
            <tr>
              <th>{t('consent.type')}</th>
              <th>{t('consent.granted')}</th>
              <th>{t('consent.channel')}</th>
              <th>{t('common.date')}</th>
            </tr>
          </thead>
          <tbody>
            {pt.consents.map((c) => (
              <tr key={c.type}>
                <td>{t(`consent.${c.type}`)}</td>
                <td>{c.granted ? <Badge tone="success">{t('common.yes')}</Badge> : <Badge tone="danger">{t('common.no')}</Badge>}</td>
                <td>
                  <span className="flex flex-wrap items-center gap-2">
                    {['reception', 'portal', 'app'].includes(c.channel) ? t(`consent.channel.${c.channel}`) : c.channel}
                    {c.signed && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const r = await get<{ url: string }>(`/patients/${pt.id}/consents/${c.id}/signature`);
                            window.open(r.url, '_blank', 'noopener,noreferrer');
                          } catch (e) {
                            toast(err(e), 'danger');
                          }
                        }}
                      >
                        {t('consent.viewSignature')}
                      </Button>
                    )}
                  </span>
                </td>
                <td>
                  <DateText value={c.created_at} locale={locale} withTime />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!current.health_data && <Alert tone="warning">{t('pat.noHealthConsent')}</Alert>}
        {can('patient:edit') && (
          <form
            className="flex flex-col gap-2 border-t border-border pt-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const changed = Object.fromEntries(Object.entries(v).filter(([k, val]) => current[k] !== val || current[k] === undefined));
              const r = await a.run(() => post(`/patients/${pt.id}/consents`, { consents: changed, signatureDataUrl: signature ?? undefined }));
              if (r) {
                toast(t('common.saved'));
                setSignature(null);
                setSigKey((k) => k + 1);
                onSaved();
              }
            }}
          >
            <p className="text-sm text-muted">{t('consent.recordHint')}</p>
            {CONSENT_TYPES.map((c) => (
              <Check key={c} label={t(`consent.${c}`)} checked={!!v[c]} onChange={(x) => setV({ ...v, [c]: x })} />
            ))}
            <SignaturePad key={sigKey} label={t('sig.label')} onChange={setSignature} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy} className="self-start">
              {t('consent.record')}
            </Button>
          </form>
        )}
      </div>
    </Section>
  );
}

function Messages({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const q = useApi<{ id: string; event: string; channel: string; status: string; segments: number | null; cost: number | null; created_at: string; error: string | null }[]>(`/patients/${id}/messages`);
  return (
    <Section title={t('pat.tab.messages')}>
      <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
        {(rows) => (
          <Table>
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('msg.event')}</th>
                <th>{t('msg.channel')}</th>
                <th>{t('common.status')}</th>
                <th>{t('msg.segments')}</th>
                <th>{t('msg.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <DateText value={m.created_at} locale={locale} withTime />
                  </td>
                  <td>{t(`event.${m.event}`)}</td>
                  <td>{t(`chan.${m.channel}`)}</td>
                  <td>
                    <Badge tone={m.status === 'delivered' ? 'success' : m.status === 'failed' ? 'danger' : 'neutral'}>{t(`state.${m.status}`)}</Badge>
                  </td>
                  <td className="num">{m.segments ?? '—'}</td>
                  <td>{m.cost !== null ? <Money value={num(m.cost)} locale={locale} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </DataState>
    </Section>
  );
}

function Billing({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const st = useApi<{ bills: BillRow[]; balance: number }>(`/patients/${id}/statement`);
  const bills = useApi<BillRow[]>(`/bills?patientId=${id}`);
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('pat.statement')} actions={st.data && <span className="text-sm">{t('bill.balance')}: <strong>{formatMoney(num(st.data.balance), locale)}</strong></span>}>
        <DataState loading={bills.loading} error={bills.error} data={bills.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('bill.number')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.total')}</th>
                  <th>{t('bill.paid')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link className="underline" href={`/cashier/bills/${b.id}`}>
                        <Bdi className="num">{b.number ?? t('bill.draft')}</Bdi>
                      </Link>
                    </td>
                    <td>
                      <DateText value={b.issued_at ?? b.created_at} locale={locale} />
                    </td>
                    <td>
                      <Badge>{t(`billStatus.${b.status}`)}</Badge>
                    </td>
                    <td>
                      <Money value={num(b.total)} locale={locale} />
                    </td>
                    <td>
                      <Money value={num(b.paid) - num(b.refunded)} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
    </div>
  );
}

function Merge({ pt }: { pt: PatientDetail }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [source, setSource] = useState<PatientRow | null>(null);
  const [asking, setAsking] = useState(false);
  const mq = useApi<{ id: string; source_patient_id: string; target_patient_id: string; reason: string; merged_at: string; unmerged_at: string | null; can_unmerge: boolean }[]>(`/patients/${pt.id}/merges`);
  const merges = (mq.data ?? []).filter((m) => !m.unmerged_at && m.target_patient_id === pt.id);
  const a = useAction();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('merge.title')}>
        <div className="flex flex-col gap-3">
          <Alert tone="info">{t('merge.intro')}</Alert>
          <PatientSearch id="merge-source" onSelect={(p) => setSource(p.id === pt.id ? null : p)} selectedId={source?.id} compact />
          {source && (
            <div className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
              <span>
                {t('merge.source')}: <Bdi className="font-medium">{patientName(source, locale)}</Bdi> (<Bdi className="num">{source.mrn}</Bdi>)
              </span>
              <Button size="sm" variant="danger" onClick={() => setAsking(true)}>
                {t('merge.do')}
              </Button>
            </div>
          )}
          {a.error && <Alert tone="danger">{a.error}</Alert>}
        </div>
      </Section>
      <Section title={t('merge.recent')}>
        {mq.error ? (
          <ErrorAlert error={mq.error} />
        ) : merges.length === 0 ? (
          <p className="text-sm text-muted">{t('merge.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {merges.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
                <span>
                  <Link className="underline" href={`/patients/${m.source_patient_id}`}>
                    {t('merge.mergedRecord')}
                  </Link>{' '}
                  · <DateText value={m.merged_at} locale={locale} /> · <span dir="auto">{m.reason}</span>
                </span>
                {m.can_unmerge && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const r = await a.run(() => post(`/patients/merges/${m.id}/unmerge`));
                      if (r) {
                        toast(t('merge.unmerged'));
                        mq.reload();
                      }
                    }}
                  >
                    {t('merge.unmerge')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">{t('merge.window')}</p>
      </Section>
      <ReasonDialog
        open={asking}
        title={t('merge.confirm')}
        onClose={() => setAsking(false)}
        onSubmit={async (reason) => {
          if (!source) return;
          await post<{ id: string }>(`/patients/${pt.id}/merge`, { sourcePatientId: source.id, reason });
          mq.reload();
          toast(t('merge.done'));
          setSource(null);
        }}
      />
      {a.busy && <Loading />}
      <ErrorAlert error={null} />
    </div>
  );
}
