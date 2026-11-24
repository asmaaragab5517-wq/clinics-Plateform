'use client';

import { useEffect, useRef, useState } from 'react';
import { addDays } from '@hf/shared/datetime';
import { Alert, Badge, Bdi, Button, DateText, Select, Textarea } from '@hf/ui';
import { post, qs, upload } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { todayCairo } from '@/lib/format';
import { Check, TextField, useAction } from './common';
import { useI18n } from './i18n';
import { useToast } from './toast';

/** AI assistance (BR-19): every output is a draft the doctor reviews; only the fields the doctor keeps are written. */

export interface AiSettings {
  enabled: boolean;
  model: string;
  promptVersion: string;
  mode: string;
}

export function useAiEnabled(): boolean {
  const r = useApi<AiSettings>('/ai/settings');
  return !!r.data?.enabled;
}

/** The mandatory label on every AI draft. */
export function AiDraftLabel() {
  const { t } = useI18n();
  return (
    <div role="note" className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent/5 px-3 py-2 text-sm font-medium text-accent">
      <Badge tone="primary">{t('ai.badge')}</Badge>
      <span>{t('ai.draftLabel')}</span>
    </div>
  );
}

interface Draft<O, W> {
  id: string;
  kind: string;
  status: string;
  output: O;
  warnings: W[];
  transcript?: string;
}

interface PendingDraftRow<O> {
  id: string;
  kind: string;
  status: string;
  output: O;
  warnings: unknown[];
  encounter_id: string | null;
  created_at: string;
}

/** The doctor's own pending drafts of one kind for a visit (the API lists the last 24 hours), to resume a review. */
function usePendingDrafts<O>(encounterId: string, kind: string) {
  const q = useApi<PendingDraftRow<O>[]>(`/ai/drafts${qs({ encounterId, status: 'pending' })}`);
  return { rows: (q.data ?? []).filter((d) => d.kind === kind), reload: q.reload };
}

/** "Unreviewed drafts" list shown before a new draft is requested. */
function PendingDrafts<O>({ rows, preview, onOpen }: { rows: PendingDraftRow<O>[]; preview: (o: O) => string; onOpen: (d: PendingDraftRow<O>) => void }) {
  const { t, locale } = useI18n();
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm" role="region" aria-label={t('ai.pendingTitle')}>
      <p className="font-medium">{t('ai.pendingTitle')}</p>
      <p className="mb-2 text-xs text-muted">{t('ai.pendingHint')}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{t('ai.badge')}</Badge>
            <span className="text-xs text-muted">
              <DateText value={d.created_at} locale={locale} withTime />
            </span>
            <span dir="auto" className="min-w-0 flex-1 truncate">
              {preview(d.output) || '—'}
            </span>
            <Button type="button" size="sm" variant="secondary" onClick={() => onOpen(d)}>
              {t('ai.reviewDraft')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reject a draft (audited) and close it; errors are surfaced as a toast. */
function useReject() {
  const toast = useToast();
  const { t, err } = useI18n();
  return async (id: string) => {
    try {
      await post(`/ai/drafts/${id}/reject`);
      toast(t('ai.rejected'), 'info');
    } catch (e) {
      toast(err(e), 'danger');
    }
  };
}

// ---------------------------------------------------------------- Scribe (dictation → encounter draft)

export const DRAFT_VITALS = ['systolic', 'diastolic', 'heartRate', 'temperatureC', 'respiratoryRate', 'spo2', 'weightKg', 'heightCm'] as const;
type DraftVital = (typeof DRAFT_VITALS)[number];

interface EncounterOutput {
  chiefComplaint: string;
  hpi: string;
  examination: string;
  notes: string;
  vitals: Record<DraftVital, number | null>;
  diagnoses: { code: string; title: string; stated: boolean }[];
  followUpInDays: number | null;
  missingInformation: string[];
}
interface EncounterWarning {
  field: string;
  issue: string;
  value?: unknown;
}

const TEXT_FIELDS = ['chiefComplaint', 'hpi', 'examination', 'notes'] as const;
type TextFieldKey = (typeof TEXT_FIELDS)[number];
const FIELD_LABEL: Record<TextFieldKey, string> = { chiefComplaint: 'emr.chiefComplaint', hpi: 'emr.hpi', examination: 'emr.examination', notes: 'emr.notes' };

export interface EncounterCurrent {
  chiefComplaint: string;
  hpi: string;
  examination: string;
  notes: string;
  vitals: Record<string, string>;
  diagnoses: { code: string; primary: boolean; title?: string }[];
  followUpDate: string;
}

export interface EncounterApplied {
  chiefComplaint?: string;
  hpi?: string;
  examination?: string;
  notes?: string;
  vitals?: Record<string, number>;
  diagnoses?: { code: string; primary: boolean; title?: string }[];
  followUpDate?: string | null;
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MediaRecorder.isTypeSupported(m)) return m;
  return undefined;
}

function Recorder({ onAudio, disabled }: { onAudio: (b: Blob) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'idle' | 'recording'>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia), []);
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);
  useEffect(() => () => stream.current?.getTracks().forEach((x) => x.stop()), []);

  async function start() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        s.getTracks().forEach((x) => x.stop());
        onAudio(new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' }));
      };
      r.start();
      rec.current = r;
      setSecs(0);
      setState('recording');
    } catch {
      setError(t('ai.micDenied'));
    }
  }
  function stop() {
    rec.current?.stop();
    rec.current = null;
    setState('idle');
  }
  if (!supported) return <p className="text-xs text-muted">{t('ai.noRecorder')}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === 'idle' ? (
        <Button type="button" variant="secondary" onClick={() => void start()} disabled={disabled}>
          {t('ai.record')}
        </Button>
      ) : (
        <Button type="button" variant="danger" onClick={stop}>
          {t('ai.stop')}
        </Button>
      )}
      {state === 'recording' && (
        <span className="num text-sm text-danger" role="status">
          {t('ai.recording', { s: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` })}
        </span>
      )}
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export function ScribePanel({ encounterId, current, onApplied }: { encounterId: string; current: EncounterCurrent; onApplied: (v: EncounterApplied) => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<'auto' | 'ar' | 'en'>(locale);
  const [draft, setDraft] = useState<Draft<EncounterOutput, EncounterWarning> | null>(null);
  const a = useAction();
  const reject = useReject();
  const pending = usePendingDrafts<EncounterOutput>(encounterId, 'encounter_note');
  const close = () => {
    setDraft(null);
    pending.reload();
  };

  async function send(audio?: Blob) {
    const r = await a.run(() => {
      if (audio) {
        const fd = new FormData();
        const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm';
        fd.set('audio', audio, `dictation.${ext}`);
        fd.set('language', language);
        return upload<Draft<EncounterOutput, EncounterWarning>>(`/encounters/${encounterId}/ai/dictation`, fd);
      }
      return post<Draft<EncounterOutput, EncounterWarning>>(`/encounters/${encounterId}/ai/dictation`, { text, language });
    });
    if (r) {
      setDraft(r);
      pending.reload();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!draft && (
        <>
          <PendingDrafts
            rows={pending.rows}
            preview={(o) => [o.chiefComplaint, o.hpi].filter(Boolean).join(' · ')}
            onOpen={(d) => {
              a.setError(null);
              setDraft({ id: d.id, kind: d.kind, status: d.status, output: d.output, warnings: d.warnings as EncounterWarning[] });
            }}
          />
          <p className="text-sm text-muted">{t('ai.scribeIntro')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('ai.language')}
              <Select className="h-10 w-40" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                <option value="auto">{t('ai.lang.auto')}</option>
                <option value="ar">{t('ai.lang.ar')}</option>
                <option value="en">{t('ai.lang.en')}</option>
              </Select>
            </label>
            <Recorder onAudio={(b) => void send(b)} disabled={a.busy} />
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length < 5) return a.setError(t('ai.textMin'));
              void send();
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label={t('ai.typeDictation')} placeholder={t('ai.typeDictation')} dir="auto" />
            <Button type="submit" variant="secondary" className="self-start" disabled={a.busy}>
              {a.busy ? t('ai.working') : t('ai.draftFromText')}
            </Button>
          </form>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
        </>
      )}
      {draft && (
        <EncounterReview
          draft={draft}
          current={current}
          onDone={(applied) => {
            close();
            setText('');
            if (applied) {
              onApplied(applied);
              toast(t('ai.applied'));
            }
          }}
          onReject={async () => {
            await reject(draft.id);
            close();
          }}
          onLater={close}
        />
      )}
    </div>
  );
}

function EncounterReview({ draft, current, onDone, onReject, onLater }: { draft: Draft<EncounterOutput, EncounterWarning>; current: EncounterCurrent; onDone: (applied: EncounterApplied | null) => void; onReject: () => Promise<void>; onLater: () => void }) {
  const { t } = useI18n();
  const o = draft.output;
  const [texts, setTexts] = useState<Record<TextFieldKey, string>>({ chiefComplaint: o.chiefComplaint, hpi: o.hpi, examination: o.examination, notes: o.notes });
  // Nothing is selected unless the draft actually proposes a value; the doctor opts in field by field.
  const [useText, setUseText] = useState<Record<TextFieldKey, boolean>>({ chiefComplaint: false, hpi: false, examination: false, notes: false });
  const proposedVitals = DRAFT_VITALS.filter((k) => o.vitals[k] !== null && o.vitals[k] !== undefined);
  const [vitals, setVitals] = useState<Record<string, string>>(Object.fromEntries(proposedVitals.map((k) => [k, String(o.vitals[k])])));
  const [useVital, setUseVital] = useState<Record<string, boolean>>({});
  const [dxSel, setDxSel] = useState<Record<string, boolean>>({});
  const [fuDate, setFuDate] = useState(o.followUpInDays ? addDays(todayCairo(), o.followUpInDays) : '');
  const [useFu, setUseFu] = useState(false);
  const a = useAction();
  const warnings = draft.warnings.filter((w) => w.field !== 'missing');
  const missing = draft.warnings.filter((w) => w.field === 'missing').map((w) => w.issue);
  const existingCodes = current.diagnoses.map((d) => d.code);
  const newDx = o.diagnoses.filter((d) => !existingCodes.includes(d.code));
  const anySelected = TEXT_FIELDS.some((k) => useText[k]) || Object.values(useVital).some(Boolean) || Object.values(dxSel).some(Boolean) || useFu;

  async function approve() {
    const body: Record<string, unknown> = {};
    const applied: EncounterApplied = {};
    for (const k of TEXT_FIELDS) {
      if (!useText[k]) continue;
      body[k] = texts[k];
      applied[k] = texts[k];
    }
    const v: Record<string, number> = {};
    for (const k of Object.keys(useVital)) {
      if (!useVital[k]) continue;
      const n = Number(vitals[k]);
      if (vitals[k] === '' || !Number.isFinite(n)) return a.setError(t('ai.invalidVital', { field: t(`vitals.${k}`) }));
      v[k] = ['temperatureC', 'weightKg', 'heightCm'].includes(k) ? n : Math.round(n);
    }
    if (Object.keys(v).length) {
      body.vitals = v;
      applied.vitals = v;
    }
    const picked = newDx.filter((d) => dxSel[d.code]);
    if (picked.length) {
      // The API replaces the diagnosis list: keep the doctor's existing diagnoses (primary first) and append the picked ones.
      const ordered = [...current.diagnoses].sort((x, y) => Number(y.primary) - Number(x.primary));
      const list = [...ordered.map((d) => ({ code: d.code, title: d.title })), ...picked.map((d) => ({ code: d.code, title: d.title }))];
      body.diagnosisCodes = list.map((d) => d.code);
      applied.diagnoses = list.map((d, i) => ({ code: d.code, title: d.title, primary: i === 0 }));
    }
    if (useFu) {
      body.followUpDate = fuDate || null;
      applied.followUpDate = fuDate || null;
    }
    const r = await a.run(() => post(`/ai/drafts/${draft.id}/approve`, body));
    if (r) onDone(applied);
  }

  return (
    <div className="flex flex-col gap-3">
      <AiDraftLabel />
      {draft.transcript && (
        <details className="rounded-lg border border-border p-2 text-sm">
          <summary className="cursor-pointer text-muted">{t('ai.transcript')}</summary>
          <p dir="auto" className="mt-2 whitespace-pre-wrap">
            {draft.transcript}
          </p>
        </details>
      )}
      {(warnings.length > 0 || missing.length > 0) && (
        <div className="grid gap-2 md:grid-cols-2">
          {warnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-sm">
              <p className="mb-1 font-medium text-warning">{t('ai.warnings')}</p>
              <ul className="flex flex-col gap-1">
                {warnings.map((w, i) => (
                  <li key={i}>
                    <Badge tone="warning">{t(`ai.issue.${w.issue}`)}</Badge> <span>{w.field.startsWith('vitals.') ? t(`vitals.${w.field.slice(7)}`) : t(`ai.field.${w.field}`)}</span>
                    {w.value !== undefined && w.value !== null && <bdi dir="ltr" className="ms-1 text-xs text-muted">{typeof w.value === 'object' ? String((w.value as { code?: string }).code ?? '') + ' ' + String((w.value as { title?: string }).title ?? '') : String(w.value)}</bdi>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missing.length > 0 && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-2 text-sm">
              <p className="mb-1 font-medium text-accent">{t('ai.missing')}</p>
              <ul className="list-inside list-disc">
                {missing.map((m, i) => (
                  <li key={i} dir="auto">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted">{t('ai.reviewHint')}</p>
      {TEXT_FIELDS.map((k) =>
        !o[k] ? null : (
          <fieldset key={k} className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{t(FIELD_LABEL[k])}</legend>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{t('ai.current')}</span>
              <p dir="auto" className="min-h-10 whitespace-pre-wrap rounded-lg bg-bg p-2 text-sm">
                {current[k] || '—'}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-accent">{t('ai.proposed')}</span>
              <Textarea value={texts[k]} rows={3} dir="auto" aria-label={`${t(FIELD_LABEL[k])} · ${t('ai.proposed')}`} onChange={(e) => (setTexts({ ...texts, [k]: e.target.value }), setUseText({ ...useText, [k]: true }))} />
              <Check label={current[k] ? t('ai.replaceField') : t('ai.useField')} checked={useText[k]} onChange={(x) => setUseText({ ...useText, [k]: x })} />
            </div>
          </fieldset>
        ),
      )}
      {proposedVitals.length > 0 && (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('emr.vitals')}</legend>
          <div className="grid gap-3 md:grid-cols-4">
            {proposedVitals.map((k) => (
              <div key={k} className="flex flex-col gap-1">
                <TextField label={`${t(`vitals.${k}`)} · ${t('ai.current')}: ${current.vitals[k] || '—'}`} type="number" step="0.1" value={vitals[k] ?? ''} onChange={(e) => (setVitals({ ...vitals, [k]: e.target.value }), setUseVital({ ...useVital, [k]: true }))} dir="ltr" />
                <Check label={t('ai.useField')} checked={!!useVital[k]} onChange={(x) => setUseVital({ ...useVital, [k]: x })} />
              </div>
            ))}
          </div>
        </fieldset>
      )}
      {o.diagnoses.length > 0 && (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('emr.diagnoses')}</legend>
          <ul className="flex flex-col gap-1 text-sm">
            {o.diagnoses.map((d) => (
              <li key={d.code} className="flex items-center gap-2">
                {existingCodes.includes(d.code) ? (
                  <span className="text-xs text-muted">{t('ai.alreadyRecorded')}</span>
                ) : (
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--hf-primary))]" checked={!!dxSel[d.code]} onChange={(e) => setDxSel({ ...dxSel, [d.code]: e.target.checked })} aria-label={`${t('ai.addDiagnosis')} ${d.code}`} />
                )}
                <Bdi className="num font-medium">{d.code}</Bdi>
                <span dir="auto">{d.title}</span>
                {!d.stated && <Badge tone="warning">{t('ai.inferred')}</Badge>}
              </li>
            ))}
          </ul>
          {current.diagnoses.length > 0 && <p className="mt-2 text-xs text-muted">{t('ai.dxKeepsExisting')}</p>}
        </fieldset>
      )}
      {o.followUpInDays !== null && (
        <fieldset className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-2">
          <legend className="px-1 text-sm font-medium">{t('enc.followUpDate')}</legend>
          <p className="text-sm">
            {t('ai.current')}: <span className="num">{current.followUpDate || '—'}</span>
          </p>
          <div className="flex flex-col gap-1">
            <TextField label={t('ai.proposed')} type="date" value={fuDate} onChange={(e) => (setFuDate(e.target.value), setUseFu(true))} />
            <Check label={t('ai.useField')} checked={useFu} onChange={setUseFu} />
          </div>
        </fieldset>
      )}
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void approve()} disabled={a.busy || !anySelected}>
          {t('ai.approveSelected')}
        </Button>
        <Button variant="secondary" onClick={() => void onReject()} disabled={a.busy}>
          {t('ai.reject')}
        </Button>
        <Button variant="ghost" onClick={onLater} disabled={a.busy}>
          {t('ai.reviewLater')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Patient summary

export function AiSummaryDraft({ encounterId, current, onApplied }: { encounterId: string; current: string; onApplied: (text: string) => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft<{ summaryAr: string; summaryEn: string }, never> | null>(null);
  const [ar, setAr] = useState('');
  const [en, setEn] = useState('');
  const [useAr, setUseAr] = useState(true);
  const [useEn, setUseEn] = useState(false);
  const a = useAction();
  const reject = useReject();
  const pending = usePendingDrafts<{ summaryAr: string; summaryEn: string }>(encounterId, 'patient_summary');
  const open = (r: Draft<{ summaryAr: string; summaryEn: string }, never>) => {
    setDraft(r);
    setAr(r.output.summaryAr ?? '');
    setEn(r.output.summaryEn ?? '');
    setUseAr(true);
    setUseEn(locale === 'en');
  };
  const close = () => {
    setDraft(null);
    pending.reload();
  };
  if (!draft)
    return (
      <div className="flex flex-col gap-2">
        <PendingDrafts rows={pending.rows} preview={(o) => (locale === 'en' ? o.summaryEn || o.summaryAr : o.summaryAr || o.summaryEn)} onOpen={(d) => (a.setError(null), open({ id: d.id, kind: d.kind, status: d.status, output: d.output, warnings: [] }))} />
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          disabled={a.busy}
          onClick={async () => {
            const r = await a.run(() => post<Draft<{ summaryAr: string; summaryEn: string }, never>>(`/encounters/${encounterId}/ai/patient-summary`));
            if (r) {
              open(r);
              pending.reload();
            }
          }}
        >
          {a.busy ? t('ai.working') : t('ai.draftSummary')}
        </Button>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
      </div>
    );
  const text = [useAr ? ar.trim() : '', useEn ? en.trim() : ''].filter(Boolean).join('\n\n');
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
      <AiDraftLabel />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t('ai.current')}</span>
        <p dir="auto" className="whitespace-pre-wrap rounded-lg bg-bg p-2 text-sm">
          {current || '—'}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Textarea value={ar} onChange={(e) => setAr(e.target.value)} rows={5} dir="rtl" lang="ar" aria-label={t('ai.summaryAr')} />
          <Check label={t('ai.summaryAr')} checked={useAr} onChange={setUseAr} />
        </div>
        <div className="flex flex-col gap-1">
          <Textarea value={en} onChange={(e) => setEn(e.target.value)} rows={5} dir="ltr" lang="en" aria-label={t('ai.summaryEn')} />
          <Check label={t('ai.summaryEn')} checked={useEn} onChange={setUseEn} />
        </div>
      </div>
      <p className="text-xs text-muted">{t('ai.summaryHint')}</p>
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={a.busy || text.length < 10}
          onClick={async () => {
            const r = await a.run(() => post(`/ai/drafts/${draft.id}/approve`, { text }));
            if (r) {
              onApplied(text);
              close();
              toast(t('ai.summaryApproved'));
            }
          }}
        >
          {t('ai.approveAndShare')}
        </Button>
        <Button
          variant="secondary"
          disabled={a.busy}
          onClick={async () => {
            await reject(draft.id);
            close();
          }}
        >
          {t('ai.reject')}
        </Button>
        <Button variant="ghost" disabled={a.busy} onClick={close}>
          {t('ai.reviewLater')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Prescription wording

export interface RxLineWording {
  label: string;
  instructionsAr: string;
  instructionsEn: string;
}

type RxDraft = Draft<{ lines: { index: number; instructionsAr: string; instructionsEn: string }[] }, { index: number; issue: string }>;

export function AiRxWording({ prescriptionId, lines, onApplied }: { prescriptionId: string; lines: RxLineWording[] | null; onApplied: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState<RxDraft | null>(null);
  const [vals, setVals] = useState<Record<number, { ar: string; en: string; use: boolean }>>({});
  const a = useAction();
  const reject = useReject();
  if (!draft)
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={a.busy}
          onClick={async () => {
            const r = await a.run(() => post<RxDraft>(`/prescriptions/${prescriptionId}/ai/instructions`));
            if (r) {
              setDraft(r);
              setVals(Object.fromEntries(r.output.lines.map((l) => [l.index, { ar: l.instructionsAr, en: l.instructionsEn, use: true }])));
            }
          }}
        >
          {a.busy ? t('ai.working') : t('ai.rxWording')}
        </Button>
        {a.error && (
          <p role="alert" className="text-xs text-danger">
            {a.error}
          </p>
        )}
      </div>
    );
  const chosen = draft.output.lines.filter((l) => vals[l.index]?.use);
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-border p-3">
      <AiDraftLabel />
      {draft.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {draft.warnings.map((w, i) => (
            <li key={i}>
              <Badge tone="warning">{t(`ai.issue.${w.issue}`)}</Badge> {t('rx.line', { n: w.index + 1 })}
            </li>
          ))}
        </ul>
      )}
      {draft.output.lines.map((l) => {
        const cur = lines?.[l.index];
        const v = vals[l.index] ?? { ar: '', en: '', use: false };
        return (
          <fieldset key={l.index} className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <legend className="px-1 text-sm font-medium">
              {t('rx.line', { n: l.index + 1 })} {cur?.label && <Bdi className="text-muted">{cur.label}</Bdi>}
            </legend>
            {cur && (
              <p className="text-xs text-muted">
                {t('ai.current')}: <bdi dir="rtl">{cur.instructionsAr || '—'}</bdi> · <bdi dir="ltr">{cur.instructionsEn || '—'}</bdi>
              </p>
            )}
            <div className="grid gap-2 md:grid-cols-2">
              <TextField label={t('rx.instructionsAr')} value={v.ar} onChange={(e) => setVals({ ...vals, [l.index]: { ...v, ar: e.target.value } })} dir="rtl" lang="ar" />
              <TextField label={t('rx.instructionsEn')} value={v.en} onChange={(e) => setVals({ ...vals, [l.index]: { ...v, en: e.target.value } })} dir="ltr" lang="en" />
            </div>
            <Check label={t('ai.useField')} checked={v.use} onChange={(x) => setVals({ ...vals, [l.index]: { ...v, use: x } })} />
          </fieldset>
        );
      })}
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={a.busy || chosen.length === 0}
          onClick={async () => {
            const r = await a.run(() => post(`/ai/drafts/${draft.id}/approve`, { lines: chosen.map((l) => ({ index: l.index, instructionsAr: vals[l.index]!.ar, instructionsEn: vals[l.index]!.en })) }));
            if (r) {
              setDraft(null);
              toast(t('ai.applied'));
              onApplied();
            }
          }}
        >
          {t('ai.approveSelected')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={a.busy}
          onClick={async () => {
            await reject(draft.id);
            setDraft(null);
          }}
        >
          {t('ai.reject')}
        </Button>
      </div>
    </div>
  );
}
