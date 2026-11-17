'use client';

import { useMemo, useState } from 'react';
import { Badge, Bdi, Button, Input, Select } from '@hf/ui';
import { get, upload } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Check, TextField } from './common';
import { useI18n } from './i18n';
import { useSession } from './session';
import { useToast } from './toast';

/** FR-PAT-6 organisation-defined patient fields. Values live in `patients.custom_fields` keyed by `key`. */

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'file'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomFieldDef {
  id: string;
  entity: 'patient';
  specialty_id: string | null;
  key: string;
  label_ar: string;
  label_en: string;
  type: CustomFieldType;
  options: { value: string; ar: string; en: string }[];
  required: boolean;
  validation: { min?: number; max?: number; pattern?: string };
  visible_roles: string[];
  created_at?: string;
}

export interface FileValue {
  documentId: string;
  name: string;
}

export type CustomValues = Record<string, unknown>;

export function fieldLabel(d: CustomFieldDef, locale: 'ar' | 'en'): string {
  return locale === 'en' ? d.label_en || d.label_ar : d.label_ar || d.label_en;
}

/** Definitions visible to the current user (an empty role list means everyone). Filtered here: the API returns all. */
export function useCustomFields() {
  const { me } = useSession();
  const q = useApi<CustomFieldDef[]>('/custom-fields');
  const visible = useMemo(() => (q.data ?? []).filter((d) => d.entity === 'patient' && (!d.visible_roles?.length || d.visible_roles.some((r) => me.roles.includes(r)))), [q.data, me.roles]);
  return { defs: visible, loading: q.loading, error: q.error };
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Client-side checks (required, min/max, pattern, option values). Returns field key -> message. */
export function validateCustomFields(defs: CustomFieldDef[], values: CustomValues, t: (k: string, v?: Record<string, string | number>) => string, opts: { skipFiles?: boolean } = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const d of defs) {
    const v = values[d.key];
    if (d.type === 'file' && opts.skipFiles) continue;
    if (isEmpty(v) || (d.type === 'boolean' && v === undefined)) {
      if (d.required && d.type !== 'boolean') errors[d.key] = t('form.required');
      continue;
    }
    const { min, max, pattern } = d.validation ?? {};
    if (d.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) errors[d.key] = t('cf.err.number');
      else if (min !== undefined && n < min) errors[d.key] = t('cf.err.min', { n: min });
      else if (max !== undefined && n > max) errors[d.key] = t('cf.err.max', { n: max });
    }
    if (d.type === 'text' && typeof v === 'string') {
      if (min !== undefined && v.length < min) errors[d.key] = t('cf.err.minLength', { n: min });
      else if (max !== undefined && v.length > max) errors[d.key] = t('cf.err.maxLength', { n: max });
      else if (pattern) {
        try {
          if (!new RegExp(`^(?:${pattern})$`).test(v)) errors[d.key] = t('cf.err.pattern');
        } catch {
          /* an invalid pattern is the admin's problem, not the receptionist's */
        }
      }
    }
    if (d.type === 'select' && !d.options.some((o) => o.value === v)) errors[d.key] = t('cf.err.option');
    if (d.type === 'multiselect' && (!Array.isArray(v) || v.some((x) => !d.options.some((o) => o.value === x)))) errors[d.key] = t('cf.err.option');
  }
  return errors;
}

/** Strip empty values and coerce numbers before sending `customFields`. */
export function customFieldsPayload(defs: CustomFieldDef[], values: CustomValues, opts: { dropEmpty?: boolean } = {}): CustomValues {
  const out: CustomValues = {};
  for (const d of defs) {
    const v = values[d.key];
    if (v === undefined) continue;
    if (d.type === 'number') out[d.key] = v === '' || v === null ? null : Number(v);
    else if (d.type === 'boolean') out[d.key] = !!v;
    else out[d.key] = isEmpty(v) ? null : v;
  }
  // On create there is nothing to clear; on edit `null` clears a previous value.
  if (opts.dropEmpty) for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

export function CustomFieldValue({ def, value }: { def: CustomFieldDef; value: unknown }) {
  const { t, locale, err } = useI18n();
  const toast = useToast();
  if (isEmpty(value)) return <>—</>;
  const opt = (x: unknown) => {
    const o = def.options.find((y) => y.value === x);
    return o ? (locale === 'en' ? o.en || o.ar : o.ar || o.en) : String(x);
  };
  switch (def.type) {
    case 'boolean':
      return <>{value ? t('common.yes') : t('common.no')}</>;
    case 'select':
      return <>{opt(value)}</>;
    case 'multiselect':
      return <>{(Array.isArray(value) ? value : [value]).map(opt).join(t('common.listSep'))}</>;
    case 'date':
    case 'number':
      return <span className="num">{String(value)}</span>;
    case 'file': {
      const f = value as FileValue;
      return (
        <button
          type="button"
          className="underline"
          onClick={async () => {
            try {
              const r = await get<{ url: string }>(`/documents/${f.documentId}/url`);
              window.open(r.url, '_blank', 'noopener,noreferrer');
            } catch (e) {
              toast(err(e), 'danger');
            }
          }}
        >
          <Bdi>{f.name || t('doc.open')}</Bdi>
        </button>
      );
    }
    default:
      return <Bdi>{String(value)}</Bdi>;
  }
}

/** Inputs for each visible definition. `patientId` enables file uploads (stored as patient documents). */
export function CustomFieldInputs({ defs, values, onChange, errors, patientId }: { defs: CustomFieldDef[]; values: CustomValues; onChange: (v: CustomValues) => void; errors: Record<string, string>; patientId?: string }) {
  const { t, locale } = useI18n();
  if (!defs.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{t('cf.section')}</legend>
      {defs.map((d) => (
        <CustomFieldInput key={d.id} def={d} label={`${fieldLabel(d, locale)}${d.required ? ' *' : ''}`} value={values[d.key]} onChange={(v) => set(d.key, v)} error={errors[d.key]} patientId={patientId} />
      ))}
    </fieldset>
  );
}

function CustomFieldInput({ def, label, value, onChange, error, patientId }: { def: CustomFieldDef; label: string; value: unknown; onChange: (v: unknown) => void; error?: string; patientId?: string }) {
  const { t, locale, err } = useI18n();
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const optLabel = (o: CustomFieldDef['options'][number]) => (locale === 'en' ? o.en || o.ar : o.ar || o.en);
  const errNode = (msg?: string | null) =>
    msg ? (
      <p role="alert" className="text-xs text-danger">
        {msg}
      </p>
    ) : null;
  switch (def.type) {
    case 'text':
      return <TextField label={label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} error={error} maxLength={def.validation?.max} dir="auto" />;
    case 'number':
      return <TextField label={label} type="number" value={value === undefined || value === null ? '' : String(value)} min={def.validation?.min} max={def.validation?.max} onChange={(e) => onChange(e.target.value)} error={error} dir="ltr" />;
    case 'date':
      return <TextField label={label} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} error={error} />;
    case 'boolean':
      return (
        <div>
          <Check label={label} checked={!!value} onChange={onChange} />
          {errNode(error)}
        </div>
      );
    case 'select':
      return (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {label}
          <Select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined}>
            <option value="">{t('form.choose')}</option>
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {optLabel(o)}
              </option>
            ))}
          </Select>
          {errNode(error)}
        </label>
      );
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{label}</span>
          <div className="grid grid-cols-2 gap-1">
            {def.options.map((o) => (
              <Check key={o.value} label={optLabel(o)} checked={arr.includes(o.value)} onChange={(on) => onChange(on ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
            ))}
          </div>
          {errNode(error)}
        </div>
      );
    }
    case 'file': {
      const f = value as FileValue | null | undefined;
      return (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{label}</span>
          {f?.documentId && (
            <span className="flex items-center gap-2">
              <Badge tone="success">{t('cf.fileAttached')}</Badge>
              <Bdi>{f.name}</Bdi>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                {t('common.remove')}
              </Button>
            </span>
          )}
          {!patientId ? (
            <p className="text-xs text-muted">{t('cf.fileAfterRegister')}</p>
          ) : !can('emr:create') ? (
            <p className="text-xs text-muted">{t('cf.fileNoPrivilege')}</p>
          ) : (
            <Input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              disabled={busy}
              aria-label={label}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setUpErr(null);
                try {
                  const fd = new FormData();
                  fd.set('file', file);
                  fd.set('title', `${label.replace(/ \*$/, '')} - ${file.name}`);
                  fd.set('kind', 'other');
                  const r = await upload<{ id: string }>(`/patients/${patientId}/documents`, fd);
                  onChange({ documentId: r.id, name: file.name } satisfies FileValue);
                } catch (x) {
                  setUpErr(err(x));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {errNode(upErr ?? error)}
        </div>
      );
    }
  }
}
