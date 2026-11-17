'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { dentalChartSchema, mergeDentalCharts, type DentalChart } from '@hf/shared';
import { Alert, Badge, Bdi, Button, DateText, Input, PageHeader, Select, Textarea } from '@hf/ui';
import { DentalChartEditor, EMPTY_CHART, isCharted, type PatientDentalChart } from '@/components/dental-chart';
import { IcdSearch } from '@/components/icd-search';
import { AiSummaryDraft, ScribePanel, useAiEnabled, type EncounterApplied } from '@/components/ai';
import { BODY_IMAGE, BodyChart, bodyChartPng, type Marker } from '@/components/body-chart';
import { Check, DataState, FileLink, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { PrescriptionBuilder, ReauthDialog, type RxSummary } from '@/components/prescription-builder';
import { useSession, useShortcuts } from '@/components/session';
import { useToast } from '@/components/toast';
import { ApiError, get, patch, post, reauthenticate, upload } from '@/lib/api';
import { ENCOUNTER_SECTIONS, type EncounterTemplate } from '@/lib/encounters';
import { useServices } from '@/lib/data';
import { useApi, useLocalState } from '@/lib/hooks';
import { biName } from '@/lib/format';
import { VitalsFields, vitalsPayload } from '@/components/vitals';

interface Encounter {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  appointment_id: string | null;
  status: 'open' | 'signed';
  vitals: Record<string, number>;
  chief_complaint: string;
  hpi: string;
  examination: string;
  notes: string;
  diagnoses: { code: string; primary: boolean; note?: string }[];
  problems: { text: string; status: 'active' | 'resolved' }[];
  observations: { name: string; value: string }[];
  body_chart: { image: string; shapes: Marker[]; pngKey?: string } | null;
  dental_chart: DentalChart | null;
  follow_up: { date: string; serviceId?: string; note?: string } | null;
  patient_summary: string | null;
  created_at: string;
  signed_at: string | null;
  addenda: { id: string; body: string; author: string; created_at: string }[];
  orders: { id: string; kind: 'lab' | 'radiology'; test_codes: string[]; note: string | null; status: string; created_at: string }[];
  documents: { id: string; title: string; order_id: string | null }[];
  prescriptions: RxSummary[];
  allergies: { text: string; severity: string | null; ingredient: string | null }[];
}

const ALL_SECTIONS: readonly string[] = ENCOUNTER_SECTIONS;

export default function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useApi<Encounter>(`/encounters/${id}`);
  return (
    <DataState loading={q.loading} error={q.error} data={q.data}>
      {(e) => <Editor key={`${e.id}-${e.status}`} e={e} reload={q.reload} />}
    </DataState>
  );
}

function Editor({ e, reload }: { e: Encounter; reload: () => void }) {
  const { t, locale, err } = useI18n();
  const { me, can } = useSession();
  const toast = useToast();
  const mine = e.doctor_id === me.userId;
  const editable = mine && e.status === 'open' && can('emr:edit');
  const templates = useApi<EncounterTemplate[]>('/encounter-templates');
  const [tplId, setTplId] = useLocalState<string>(`hf_tpl_${me.userId}`, '');
  const tpl = templates.data?.find((x) => x.id === tplId);
  const sections = tpl?.sections?.length ? tpl.sections : ALL_SECTIONS;
  const has = (s: string) => sections.includes(s);

  const [vitals, setVitals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(e.vitals ?? {}).filter(([k]) => k !== 'bmi').map(([k, v]) => [k, String(v)])));
  const [cc, setCc] = useState(e.chief_complaint ?? '');
  const [hpi, setHpi] = useState(e.hpi ?? '');
  const [exam, setExam] = useState(e.examination ?? '');
  const [notes, setNotes] = useState(e.notes ?? '');
  const [dx, setDx] = useState<{ code: string; primary: boolean; note?: string; title?: string }[]>(e.diagnoses ?? []);
  const [problems, setProblems] = useState(e.problems ?? []);
  const [obs, setObs] = useState(e.observations ?? []);
  const [markers, setMarkers] = useState<Marker[]>((e.body_chart?.shapes ?? []).filter((s) => s.type === 'marker'));
  const [fu, setFu] = useState<{ date: string; serviceId: string; note: string }>({ date: e.follow_up?.date ?? '', serviceId: e.follow_up?.serviceId ?? '', note: e.follow_up?.note ?? '' });
  const [dirty, setDirty] = useState(false);
  const [reauth, setReauth] = useState<null | (() => Promise<void>)>(null);
  const [addendum, setAddendum] = useState('');
  const [summary, setSummary] = useState(e.patient_summary ?? '');
  const save = useAction();
  const { active: services } = useServices();
  const aiEnabled = useAiEnabled();
  const chartRef = useRef<SVGSVGElement>(null);
  // Last body chart sent to the API: the rendered PNG is only re-uploaded when the markers change.
  const savedChart = useRef(JSON.stringify((e.body_chart?.shapes ?? []).filter((x) => x.type === 'marker')));
  const [hasPng, setHasPng] = useState(!!e.body_chart?.pngKey);

  // FR-EMR-3 dental chart: shown for dentistry templates or dentists, or switched on by the doctor for this visit.
  const doctors = useApi<{ id: string; specialty_ids: string[] }[]>(can('schedule:view') ? '/doctors' : null);
  const specialties = useApi<{ id: string; slug: string }[]>('/specialties');
  const dentistryId = specialties.data?.find((x) => x.slug === 'dentistry')?.id;
  const isDentist = !!dentistryId && !!doctors.data?.find((d) => d.id === e.doctor_id)?.specialty_ids?.includes(dentistryId);
  const [dentalOn, setDentalOn] = useState(false);
  const showDental = has('dentalChart') || tpl?.specialty_slug === 'dentistry' || isDentist || !!e.dental_chart || dentalOn;
  const patientDental = useApi<PatientDentalChart>(showDental ? `/patients/${e.patient_id}/dental-chart` : null);
  const [dental, setDental] = useState<DentalChart | null>(null);
  const [dentalTouched, setDentalTouched] = useState(false);
  useEffect(() => {
    // Pre-fill the visit chart from the patient's merged chart (teeth not charted this visit keep their last state).
    if (dental || !showDental || patientDental.loading) return;
    const merged = patientDental.data?.chart ?? null;
    setDental(e.dental_chart ? (e.status === 'open' ? mergeDentalCharts(merged, e.dental_chart) : e.dental_chart) : merged ?? EMPTY_CHART);
  }, [showDental, patientDental.loading, patientDental.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setDirty(true), [vitals, cc, hpi, exam, notes, dx, problems, obs, markers, fu]);
  useEffect(() => setDirty(false), []);

  // Apply template default text to empty fields.
  useEffect(() => {
    if (!tpl || !editable) return;
    const d = tpl.defaults ?? {};
    if (d.chiefComplaint && !cc) setCc(d.chiefComplaint);
    if (d.hpi && !hpi) setHpi(d.hpi);
    if (d.examination && !exam) setExam(d.examination);
    if (d.notes && !notes) setNotes(d.notes);
  }, [tpl?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(
    () => ({
      vitals: vitalsPayload(vitals),
      chiefComplaint: cc,
      hpi,
      examination: exam,
      notes,
      diagnoses: dx.map((d) => ({ code: d.code, primary: d.primary, note: d.note || undefined })),
      problems: problems.filter((p) => p.text.trim()),
      observations: obs.filter((o) => o.name.trim()),
      bodyChart: { image: BODY_IMAGE, shapes: markers as unknown as Record<string, unknown>[] },
      followUp: fu.date ? { date: fu.date, serviceId: fu.serviceId || undefined, note: fu.note || undefined } : null,
    }),
    [vitals, cc, hpi, exam, notes, dx, problems, obs, markers, fu],
  );

  async function doSave(quiet = false) {
    const chartJson = JSON.stringify(markers);
    const chartChanged = chartJson !== savedChart.current;
    let pngDataUrl: string | undefined;
    if (chartRef.current && chartChanged) {
      try {
        pngDataUrl = await bodyChartPng(chartRef.current);
      } catch {
        pngDataUrl = undefined; // vector shapes are still saved; the image is regenerated on the next change
      }
    }
    // An unchanged chart is left out: re-sending it without a PNG would drop the stored image reference.
    const { bodyChart, ...rest } = body;
    const payload = !chartChanged ? rest : pngDataUrl ? { ...rest, bodyChart: { ...bodyChart, pngDataUrl } } : body;
    let dentalChart: DentalChart | undefined;
    if (dental && dentalTouched) {
      const parsed = dentalChartSchema.safeParse({ ...dental, teeth: dental.teeth.filter(isCharted) });
      if (!parsed.success) {
        const m = parsed.error.issues[0]?.message ?? '';
        const key = `dental.err.${m.replace(/_\d+$/, '')}`;
        save.setError(`${t('dental.invalid')} ${t(key) === key ? '' : t(key)}`.trim());
        return false;
      }
      dentalChart = parsed.data;
    }
    const r = await save.run(() => patch(`/encounters/${e.id}`, dentalChart ? { ...payload, dentalChart } : payload));
    if (r) {
      setDirty(false);
      if (dentalChart) setDentalTouched(false);
      if (chartChanged) {
        savedChart.current = chartJson;
        setHasPng(!!pngDataUrl);
      }
      if (!quiet) toast(t('common.saved'));
    }
    return !!r;
  }

  /** Apply AI-approved values to the editor so a later save does not overwrite them with stale text. */
  function applyAi(v: EncounterApplied) {
    if (v.chiefComplaint !== undefined) setCc(v.chiefComplaint);
    if (v.hpi !== undefined) setHpi(v.hpi);
    if (v.examination !== undefined) setExam(v.examination);
    if (v.notes !== undefined) setNotes(v.notes);
    if (v.vitals) setVitals((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(v.vitals!).map(([k, n]) => [k, String(n)])) }));
    if (v.diagnoses) setDx(v.diagnoses);
    if (v.followUpDate !== undefined) setFu((cur) => ({ ...cur, date: v.followUpDate ?? '' }));
  }

  async function sign() {
    if (!(await doSave(true))) return;
    try {
      await post(`/encounters/${e.id}/sign`);
      toast(t('enc.signedOk'));
      reload();
    } catch (x) {
      if (x instanceof ApiError && x.code === 'reauthentication_required') {
        setReauth(() => async () => {
          if (await reauthenticate(window.location.pathname)) await sign();
        });
        return;
      }
      toast(err(x), 'danger');
    }
  }

  useShortcuts({});
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && editable) {
        ev.preventDefault();
        void doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('enc.title')}
        subtitle={`${t(`enc.status.${e.status}`)} · ${new Date(e.created_at).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')}`}
        actions={
          <>
            <Link href={`/patients/${e.patient_id}`} className="inline-flex h-10 items-center rounded-xl border border-border px-4 hover:bg-bg">
              {t('enc.patientRecord')}
            </Link>
            <FileLink href={`/encounters/${e.id}/summary.pdf`}>{t('enc.summaryPdf')}</FileLink>
            {editable && (
              <>
                <Button variant="secondary" onClick={() => void doSave()} disabled={save.busy}>
                  {t('common.save')} {dirty ? '•' : ''}
                </Button>
                {can('emr:approve') && (
                  <Button onClick={() => void sign()} disabled={save.busy}>
                    {t('emr.signOff')}
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
      {e.allergies.length > 0 && (
        <div role="alert" className="rounded-xl border-2 border-danger bg-danger/10 p-3 text-danger">
          <strong>{t('patient.allergies')}:</strong> {e.allergies.map((a) => `${a.text}${a.severity ? ` (${t(`severity.${a.severity}`)})` : ''}`).join(' · ')}
        </div>
      )}
      {e.status === 'signed' && <Alert tone="success">{t('enc.signedNotice')}</Alert>}
      {!mine && <Alert tone="info">{t('enc.notYours')}</Alert>}
      {save.error && <Alert tone="danger">{save.error}</Alert>}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('enc.template')}
          <Select className="h-8 w-64" value={tplId} onChange={(ev) => setTplId(ev.target.value)}>
            <option value="">{t('enc.allSections')}</option>
            {(templates.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {biName(x, locale)}
                {x.doctor_id ? ` · ${t('tpl.personal')}` : ''}
              </option>
            ))}
          </Select>
        </label>
          <Link href="/doctor/templates" className="text-xs underline">
            {t('tpl.manage')}
          </Link>
          {!showDental && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setDentalOn(true)}>
              {t('dental.enable')}
            </Button>
          )}
        </div>
      )}
      {editable && aiEnabled && can('emr:approve') && (
        <Section title={t('ai.scribeTitle')}>
          <ScribePanel encounterId={e.id} current={{ chiefComplaint: cc, hpi, examination: exam, notes, vitals, diagnoses: dx, followUpDate: fu.date }} onApplied={applyAi} />
        </Section>
      )}
      {has('vitals') && (
        <Section title={t('emr.vitals')}>
          <VitalsFields value={vitals} onChange={setVitals} readOnly={!editable} />
        </Section>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {has('chiefComplaint') && (
          <Section title={t('emr.chiefComplaint')}>
            <Textarea value={cc} onChange={(ev) => setCc(ev.target.value)} readOnly={!editable} aria-label={t('emr.chiefComplaint')} rows={3} />
          </Section>
        )}
        {has('hpi') && (
          <Section title={t('emr.hpi')}>
            <Textarea value={hpi} onChange={(ev) => setHpi(ev.target.value)} readOnly={!editable} aria-label={t('emr.hpi')} rows={3} />
          </Section>
        )}
        {has('examination') && (
          <Section title={t('emr.examination')}>
            <Textarea value={exam} onChange={(ev) => setExam(ev.target.value)} readOnly={!editable} aria-label={t('emr.examination')} rows={4} />
          </Section>
        )}
        {has('diagnoses') && (
          <Section title={t('emr.diagnoses')}>
            <div className="flex flex-col gap-2">
              {editable && <IcdSearch onAdd={(code, title) => !dx.some((d) => d.code === code) && setDx([...dx, { code, title, primary: dx.length === 0 }])} />}
              {editable && tpl && tpl.common_diagnoses.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tpl.common_diagnoses.map((c) => (
                    <Button key={c} type="button" size="sm" variant="ghost" onClick={() => !dx.some((d) => d.code === c) && setDx([...dx, { code: c, primary: dx.length === 0 }])}>
                      + <Bdi className="num">{c}</Bdi>
                    </Button>
                  ))}
                </div>
              )}
              {dx.length === 0 && <p className="text-sm text-muted">{t('enc.noDx')}</p>}
              <ul className="flex flex-col gap-1">
                {dx.map((d, i) => (
                  <li key={d.code} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm">
                    <Bdi className="num font-medium">{d.code}</Bdi>
                    <span className="flex-1 truncate">{d.title}</span>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="radio" name="primary-dx" checked={d.primary} disabled={!editable} onChange={() => setDx(dx.map((x, j) => ({ ...x, primary: j === i })))} />
                      {t('enc.primary')}
                    </label>
                    {editable && (
                      <Button size="sm" variant="ghost" onClick={() => setDx(dx.filter((_, j) => j !== i))}>
                        {t('common.remove')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}
        {has('problems') && (
          <Section title={t('enc.problems')} actions={editable && <Button size="sm" variant="ghost" onClick={() => setProblems([...problems, { text: '', status: 'active' }])}>{t('common.add')}</Button>}>
            <ul className="flex flex-col gap-2">
              {problems.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <Input value={p.text} readOnly={!editable} aria-label={t('enc.problem')} onChange={(ev) => setProblems(problems.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))} dir="auto" />
                  <Select className="w-32" value={p.status} disabled={!editable} aria-label={t('common.status')} onChange={(ev) => setProblems(problems.map((x, j) => (j === i ? { ...x, status: ev.target.value as 'active' | 'resolved' } : x)))}>
                    <option value="active">{t('enc.active')}</option>
                    <option value="resolved">{t('enc.resolved')}</option>
                  </Select>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {has('observations') && (
          <Section title={t('enc.observations')} actions={editable && <Button size="sm" variant="ghost" onClick={() => setObs([...obs, { name: '', value: '' }])}>{t('common.add')}</Button>}>
            <ul className="flex flex-col gap-2">
              {obs.map((o, i) => (
                <li key={i} className="grid grid-cols-2 gap-2">
                  <Input value={o.name} readOnly={!editable} aria-label={t('enc.obsName')} placeholder={t('enc.obsName')} onChange={(ev) => setObs(obs.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} dir="auto" />
                  <Input value={o.value} readOnly={!editable} aria-label={t('enc.obsValue')} placeholder={t('enc.obsValue')} onChange={(ev) => setObs(obs.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} dir="auto" />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      {has('notes') && (
        <Section title={t('emr.notes')}>
          <Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} readOnly={!editable} aria-label={t('emr.notes')} rows={6} />
        </Section>
      )}
      {has('bodyChart') && (
        <Section
          title={t('enc.bodyChart')}
          actions={
            hasPng && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await save.run(() => get<{ url: string }>(`/encounters/${e.id}/body-chart.png`));
                  if (r) window.open(r.url, '_blank', 'noopener,noreferrer');
                }}
              >
                {t('enc.bodyChartImage')}
              </Button>
            )
          }
        >
          <BodyChart markers={markers} onChange={setMarkers} readOnly={!editable} svgRef={chartRef} />
        </Section>
      )}
      {showDental && (
        <Section title={t('dental.title')} actions={dentalTouched ? <Badge tone="warning">{t('dental.unsaved')}</Badge> : undefined}>
          {patientDental.error ? (
            <Alert tone="danger">{err(patientDental.error)}</Alert>
          ) : !dental ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : (
            <DentalChartEditor
              value={dental}
              readOnly={!editable}
              onChange={(c) => {
                setDental(c);
                setDentalTouched(true);
                setDirty(true);
              }}
            />
          )}
          {(patientDental.data?.treatmentPlan.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted">{t('dental.planFromHistory', { n: patientDental.data!.treatmentPlan.length })}</p>}
        </Section>
      )}
      {has('orders') && <Orders e={e} editable={mine && can('emr:create')} reload={reload} />}
      {has('prescriptions') && <PrescriptionBuilder encounterId={e.id} prescriptions={e.prescriptions} onChanged={reload} editable={mine && can('prescription:create')} canRevoke={mine && can('prescription:approve')} returnTo={`/doctor/encounters/${e.id}`} />}
      {has('followUp') && (
        <Section title={t('enc.followUp')}>
          <div className="grid gap-3 md:grid-cols-3">
            <TextField label={t('enc.followUpDate')} type="date" value={fu.date} readOnly={!editable} onChange={(ev) => setFu({ ...fu, date: ev.target.value })} />
            <SelectField label={t('book.service')} value={fu.serviceId} disabled={!editable} placeholder={t('form.choose')} onChange={(ev) => setFu({ ...fu, serviceId: ev.target.value })} options={services.map((s) => ({ value: s.id, label: biName(s, locale) }))} />
            <TextField label={t('enc.note')} value={fu.note} readOnly={!editable} onChange={(ev) => setFu({ ...fu, note: ev.target.value })} />
          </div>
          <p className="mt-2 text-xs text-muted">{t('enc.followUpHint')}</p>
        </Section>
      )}
      {mine && (
        <Section title={t('enc.patientSummary')}>
          <form
            className="flex flex-col gap-2"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const r = await save.run(() => post(`/encounters/${e.id}/patient-summary`, { text: summary }));
              if (r) toast(t('enc.summaryShared'));
            }}
          >
            <Textarea value={summary} onChange={(ev) => setSummary(ev.target.value)} aria-label={t('enc.patientSummary')} rows={3} />
            <Button type="submit" variant="secondary" className="self-start" disabled={!summary.trim()}>
              {t('enc.shareSummary')}
            </Button>
          </form>
          {aiEnabled && can('emr:approve') && <div className="mt-3"><AiSummaryDraft encounterId={e.id} current={summary} onApplied={setSummary} /></div>}
        </Section>
      )}
      {e.status === 'signed' && (
        <Section title={t('enc.addenda')}>
          <ul className="mb-3 flex flex-col gap-2">
            {e.addenda.map((a) => (
              <li key={a.id} className="rounded-lg border border-border p-2 text-sm">
                <div className="mb-1 flex gap-2 text-xs text-muted">
                  <Bdi>{a.author}</Bdi>
                  <DateText value={a.created_at} locale={locale} withTime />
                </div>
                <p dir="auto" className="whitespace-pre-wrap">
                  {a.body}
                </p>
              </li>
            ))}
          </ul>
          {can('emr:edit') && (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (ev) => {
                ev.preventDefault();
                const r = await save.run(() => post(`/encounters/${e.id}/addenda`, { body: addendum }));
                if (r) {
                  setAddendum('');
                  reload();
                }
              }}
            >
              <TextAreaField label={t('emr.addendum')} value={addendum} onChange={(ev) => setAddendum(ev.target.value)} required />
              <Button type="submit" className="self-start" disabled={!addendum.trim()}>
                {t('enc.addAddendum')}
              </Button>
            </form>
          )}
        </Section>
      )}
      <ReauthDialog action={reauth} onClose={() => setReauth(null)} />
    </div>
  );
}

function Orders({ e, editable, reload }: { e: Encounter; editable: boolean; reload: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const tests = useApi<{ code: string; name_ar: string; name_en: string; kind: 'lab' | 'radiology' }[]>('/lab-tests');
  const [kind, setKind] = useState<'lab' | 'radiology'>('lab');
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const a = useAction();
  const name = (c: string) => {
    const x = tests.data?.find((y) => y.code === c);
    return x ? biName(x, locale) : c;
  };
  return (
    <Section title={t('enc.orders')}>
      <div className="flex flex-col gap-3">
        {e.orders.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
            <span>
              <Badge>{t(`enc.orderKind.${o.kind}`)}</Badge> {o.test_codes.map(name).join(t('common.listSep'))}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={o.status === 'reviewed' ? 'success' : o.status === 'result_received' ? 'warning' : 'neutral'}>{t(`enc.orderStatus.${o.status}`)}</Badge>
              <FileLink href={`/orders/${o.id}/request.pdf`}>{t('enc.printRequest')}</FileLink>
              {can('emr:create') && o.status === 'ordered' && (
                <label className="cursor-pointer rounded-xl border border-border px-3 py-1 text-sm hover:bg-bg">
                  {t('enc.uploadResult')}
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={async (ev) => {
                      const f = ev.target.files?.[0];
                      if (!f) return;
                      const fd = new FormData();
                      fd.set('file', f);
                      fd.set('title', f.name);
                      const r = await a.run(() => upload(`/orders/${o.id}/result`, fd));
                      if (r) {
                        toast(t('doc.uploaded'));
                        reload();
                      }
                    }}
                  />
                </label>
              )}
              {can('emr:approve') && o.status === 'result_received' && (
                <Button size="sm" variant="secondary" onClick={() => void a.run(() => post(`/orders/${o.id}/review`)).then((r) => r && reload())}>
                  {t('enc.markReviewed')}
                </Button>
              )}
            </span>
          </div>
        ))}
        {editable && (
          <form
            className="flex flex-col gap-2 border-t border-border pt-3"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const r = await a.run(() => post(`/encounters/${e.id}/orders`, { kind, testCodes: codes, note: note || undefined }));
              if (r) {
                setCodes([]);
                setNote('');
                reload();
              }
            }}
          >
            <div className="flex gap-2">
              {(['lab', 'radiology'] as const).map((k) => (
                <Button key={k} type="button" size="sm" variant={kind === k ? 'primary' : 'secondary'} onClick={() => (setKind(k), setCodes([]))}>
                  {t(`enc.orderKind.${k}`)}
                </Button>
              ))}
            </div>
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto md:grid-cols-3">
              {(tests.data ?? [])
                .filter((x) => x.kind === kind)
                .map((x) => (
                  <Check key={x.code} label={`${x.code} · ${biName(x, locale)}`} checked={codes.includes(x.code)} onChange={(v) => setCodes(v ? [...codes, x.code] : codes.filter((c) => c !== x.code))} />
                ))}
            </div>
            <TextField label={t('enc.note')} value={note} onChange={(ev) => setNote(ev.target.value)} />
            <Button type="submit" className="self-start" disabled={!codes.length || a.busy}>
              {t('enc.addOrder')}
            </Button>
          </form>
        )}
        {a.error && <Alert tone="danger">{a.error}</Alert>}
      </div>
    </Section>
  );
}
