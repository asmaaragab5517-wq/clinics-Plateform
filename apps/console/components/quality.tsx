'use client';

import { useState } from 'react';
import { Alert, Bdi, Button } from '@hf/ui';
import { post } from '@/lib/api';
import { biName, patientName } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { SelectField, TextAreaField, TextField, useAction } from './common';
import { useI18n } from './i18n';
import { PatientSearch } from './patient-search';
import { useSession } from './session';
import { useToast } from './toast';

/** Patient voice and patient safety registers (quality:*). Payloads leaving via webhooks are redacted by the API. */

export const COMPLAINT_CHANNELS = ['reception', 'phone', 'portal', 'app', 'email', 'review'] as const;
export const COMPLAINT_CATEGORIES = ['waiting_time', 'staff_behaviour', 'clinical_care', 'billing', 'facility', 'communication', 'other'] as const;
export const COMPLAINT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const INCIDENT_CATEGORIES = ['medication_error', 'fall', 'misidentification', 'infection_control', 'equipment', 'privacy', 'other'] as const;
export const INCIDENT_SEVERITIES = ['near_miss', 'no_harm', 'minor', 'moderate', 'severe', 'death'] as const;
export const INCIDENT_STATUSES = ['reported', 'investigating', 'closed'] as const;

function OptionalPatient({ value, onChange }: { value: PatientRow | null; onChange: (p: PatientRow | null) => void }) {
  const { t, locale } = useI18n();
  return value ? (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
      <span>
        {t('rec.patient')}: <Bdi className="font-medium">{patientName(value, locale)}</Bdi> <Bdi className="num text-xs text-muted">{value.mrn}</Bdi>
      </span>
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
        {t('common.remove')}
      </Button>
    </div>
  ) : (
    <details className="rounded-lg border border-border p-2 text-sm">
      <summary className="cursor-pointer">{t('quality.linkPatient')}</summary>
      <div className="mt-2">
        <PatientSearch id="quality-patient" onSelect={onChange} compact />
      </div>
    </details>
  );
}

/** Local datetime-local value (browser time) → ISO string. */
function toIso(local: string): string {
  return new Date(local).toISOString();
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function IncidentForm({ onDone }: { onDone?: () => void }) {
  const { t, locale } = useI18n();
  const { me, clinicId } = useSession();
  const toast = useToast();
  const blank = () => ({ clinicId, category: '', severity: '', description: '', occurredAt: nowLocal(), actionsTaken: '' });
  const [f, setF] = useState(blank);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const a = useAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (new Date(f.occurredAt).getTime() > Date.now() + 60_000) return a.setError(t('quality.futureDate'));
        const r = await a.run(() =>
          post('/incidents', { clinicId: f.clinicId, patientId: patient?.id, category: f.category, severity: f.severity, description: f.description.trim(), occurredAt: toIso(f.occurredAt), actionsTaken: f.actionsTaken.trim() || undefined }),
        );
        if (r) {
          toast(t('quality.incidentReported'));
          setF(blank());
          setPatient(null);
          onDone?.();
        }
      }}
    >
      <Alert tone="info">{t('quality.incidentIntro')}</Alert>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField label={t('shell.clinic')} value={f.clinicId} onChange={(e) => setF({ ...f, clinicId: e.target.value })} required options={me.clinics.map((c) => ({ value: c.id, label: biName(c, locale) }))} />
        <TextField label={t('quality.occurredAt')} type="datetime-local" value={f.occurredAt} max={nowLocal()} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} required />
        <SelectField label={t('quality.category')} value={f.category} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, category: e.target.value })} options={INCIDENT_CATEGORIES.map((c) => ({ value: c, label: t(`incident.cat.${c}`) }))} />
        <SelectField label={t('quality.severity')} value={f.severity} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, severity: e.target.value })} options={INCIDENT_SEVERITIES.map((c) => ({ value: c, label: t(`incident.sev.${c}`) }))} />
      </div>
      <TextAreaField label={t('quality.whatHappened')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required minLength={5} maxLength={5000} rows={4} dir="auto" />
      <TextAreaField label={t('quality.actionsTaken')} value={f.actionsTaken} onChange={(e) => setF({ ...f, actionsTaken: e.target.value })} maxLength={5000} rows={2} dir="auto" />
      <OptionalPatient value={patient} onChange={setPatient} />
      {['moderate', 'severe', 'death'].includes(f.severity) && <Alert tone="warning">{t('quality.escalates')}</Alert>}
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <Button type="submit" disabled={a.busy} className="self-start">
        {t('quality.submitIncident')}
      </Button>
    </form>
  );
}

export function ComplaintForm({ onDone }: { onDone?: () => void }) {
  const { t, locale } = useI18n();
  const { me, clinicId } = useSession();
  const toast = useToast();
  const blank = () => ({ clinicId, channel: 'reception', category: '', description: '' });
  const [f, setF] = useState(blank);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const a = useAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await a.run(() => post('/complaints', { clinicId: f.clinicId, patientId: patient?.id, channel: f.channel, category: f.category, description: f.description.trim() }));
        if (r) {
          toast(t('quality.complaintRecorded'));
          setF(blank());
          setPatient(null);
          onDone?.();
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField label={t('shell.clinic')} value={f.clinicId} onChange={(e) => setF({ ...f, clinicId: e.target.value })} required options={me.clinics.map((c) => ({ value: c.id, label: biName(c, locale) }))} />
        <SelectField label={t('quality.channel')} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} options={COMPLAINT_CHANNELS.map((c) => ({ value: c, label: t(`complaint.chan.${c}`) }))} />
        <SelectField label={t('quality.category')} value={f.category} required placeholder={t('form.choose')} onChange={(e) => setF({ ...f, category: e.target.value })} options={COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: t(`complaint.cat.${c}`) }))} />
      </div>
      <TextAreaField label={t('quality.complaintText')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required minLength={5} maxLength={5000} rows={4} dir="auto" />
      <OptionalPatient value={patient} onChange={setPatient} />
      {a.error && <Alert tone="danger">{a.error}</Alert>}
      <Button type="submit" disabled={a.busy} className="self-start">
        {t('quality.submitComplaint')}
      </Button>
    </form>
  );
}
