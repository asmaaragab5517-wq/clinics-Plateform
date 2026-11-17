'use client';

import { useState } from 'react';
import { ROLES } from '@hf/shared';
import { Alert, Badge, Bdi, Button, Input, PageHeader, Table } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { CUSTOM_FIELD_TYPES, fieldLabel, type CustomFieldDef, type CustomFieldType } from '@/components/custom-fields';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { biName } from '@/lib/format';

const STAFF_ROLES = ROLES.filter((r) => r !== 'patient');

const blank = () => ({
  key: '',
  labelAr: '',
  labelEn: '',
  type: 'text' as CustomFieldType,
  specialtyId: '',
  required: false,
  min: '',
  max: '',
  pattern: '',
  options: [{ value: '', ar: '', en: '' }],
  visibleRoles: [] as string[],
});

/** FR-PAT-6 custom patient fields defined by the organisation (shown on registration and the patient record). */
export default function CustomFieldsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<CustomFieldDef[]>('/custom-fields');
  const specialties = useApi<{ id: string; name_ar: string; name_en: string }[]>('/specialties');
  const [f, setF] = useState(blank);
  const a = useAction();
  const hasOptions = f.type === 'select' || f.type === 'multiselect';
  const setOpt = (i: number, p: Partial<(typeof f.options)[number]>) => setF({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.customFields')} subtitle={t('cf.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Section title={t('cf.list')} className="xl:col-span-3">
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('cf.key')}</th>
                    <th>{t('cf.label')}</th>
                    <th>{t('cf.type')}</th>
                    <th>{t('cf.options')}</th>
                    <th>{t('cf.visibleRoles')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Bdi className="num text-xs">{d.key}</Bdi>
                      </td>
                      <td>
                        {fieldLabel(d, locale)} {d.required && <Badge tone="warning">{t('cf.required')}</Badge>}
                      </td>
                      <td>{t(`cf.types.${d.type}`)}</td>
                      <td className="text-xs">
                        {d.options.length ? d.options.map((o) => (locale === 'en' ? o.en || o.ar : o.ar || o.en)).join(t('common.listSep')) : '—'}
                        {(d.validation?.min !== undefined || d.validation?.max !== undefined) && <span className="num block text-muted">{`${d.validation.min ?? '…'} – ${d.validation.max ?? '…'}`}</span>}
                      </td>
                      <td className="text-xs">{d.visible_roles.length ? d.visible_roles.map((r) => t(`role.${r}`)).join(t('common.listSep')) : t('cf.allRoles')}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </DataState>
          <p className="mt-2 text-xs text-muted">{t('cf.noEditGap')}</p>
        </Section>
        {can('settings:edit') && (
          <Section title={t('cf.new')} className="xl:col-span-2">
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!/^[a-z][a-z0-9_]{1,40}$/.test(f.key)) return a.setError(t('cf.keyRule'));
                const options = hasOptions ? f.options.filter((o) => o.value.trim()).map((o) => ({ value: o.value.trim(), ar: o.ar.trim() || o.value.trim(), en: o.en.trim() })) : [];
                if (hasOptions && options.length < 2) return a.setError(t('cf.optionsRule'));
                if (new Set(options.map((o) => o.value)).size !== options.length) return a.setError(t('cf.optionsUnique'));
                const validation: { min?: number; max?: number; pattern?: string } = {};
                if ((f.type === 'number' || f.type === 'text') && f.min.trim()) validation.min = Number(f.min);
                if ((f.type === 'number' || f.type === 'text') && f.max.trim()) validation.max = Number(f.max);
                if (f.type === 'text' && f.pattern.trim()) {
                  try {
                    new RegExp(f.pattern);
                  } catch {
                    return a.setError(t('cf.patternInvalid'));
                  }
                  validation.pattern = f.pattern.trim();
                }
                if (Object.values(validation).some((v) => typeof v === 'number' && !Number.isFinite(v))) return a.setError(t('cf.err.number'));
                const r = await a.run(() =>
                  post('/custom-fields', {
                    entity: 'patient',
                    key: f.key,
                    labelAr: f.labelAr.trim(),
                    labelEn: f.labelEn.trim(),
                    type: f.type,
                    specialtyId: f.specialtyId || undefined,
                    options,
                    required: f.required,
                    validation,
                    visibleRoles: f.visibleRoles,
                  }),
                );
                if (r) {
                  toast(t('common.saved'));
                  setF(blank());
                  q.reload();
                }
              }}
            >
              <TextField label={t('cf.key')} hint={t('cf.keyHint')} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} required pattern="[a-z][a-z0-9_]{1,40}" dir="ltr" />
              <div className="grid grid-cols-2 gap-2">
                <TextField label={t('cf.labelAr')} value={f.labelAr} onChange={(e) => setF({ ...f, labelAr: e.target.value })} required dir="rtl" lang="ar" />
                <TextField label={t('cf.labelEn')} value={f.labelEn} onChange={(e) => setF({ ...f, labelEn: e.target.value })} dir="ltr" lang="en" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SelectField label={t('cf.type')} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomFieldType })} options={CUSTOM_FIELD_TYPES.map((x) => ({ value: x, label: t(`cf.types.${x}`) }))} />
                <SelectField label={t('tpl.specialty')} value={f.specialtyId} placeholder={t('tpl.anySpecialty')} onChange={(e) => setF({ ...f, specialtyId: e.target.value })} options={(specialties.data ?? []).map((s) => ({ value: s.id, label: biName(s, locale) }))} />
              </div>
              {hasOptions && (
                <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-2">
                  <legend className="px-1 text-sm font-medium">{t('cf.options')}</legend>
                  {f.options.map((o, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
                      <Input className="h-8 text-xs" value={o.value} onChange={(e) => setOpt(i, { value: e.target.value })} placeholder={t('cf.optValue')} aria-label={t('cf.optValue')} dir="ltr" />
                      <Input className="h-8 text-xs" value={o.ar} onChange={(e) => setOpt(i, { ar: e.target.value })} placeholder={t('cf.labelAr')} aria-label={t('cf.labelAr')} dir="rtl" lang="ar" />
                      <Input className="h-8 text-xs" value={o.en} onChange={(e) => setOpt(i, { en: e.target.value })} placeholder={t('cf.labelEn')} aria-label={t('cf.labelEn')} dir="ltr" lang="en" />
                      <Button type="button" size="sm" variant="ghost" onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })} aria-label={t('common.remove')}>
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setF({ ...f, options: [...f.options, { value: '', ar: '', en: '' }] })}>
                    {t('cf.addOption')}
                  </Button>
                </fieldset>
              )}
              {(f.type === 'number' || f.type === 'text') && (
                <div className="grid grid-cols-2 gap-2">
                  <TextField label={f.type === 'text' ? t('cf.minLength') : t('cf.min')} type="number" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} dir="ltr" />
                  <TextField label={f.type === 'text' ? t('cf.maxLength') : t('cf.max')} type="number" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} dir="ltr" />
                </div>
              )}
              {f.type === 'text' && <TextField label={t('cf.pattern')} hint={t('cf.patternHint')} value={f.pattern} maxLength={200} onChange={(e) => setF({ ...f, pattern: e.target.value })} dir="ltr" />}
              {f.type === 'file' && <p className="text-xs text-muted">{t('cf.fileHint')}</p>}
              <Check label={t('cf.required')} checked={f.required} onChange={(v) => setF({ ...f, required: v })} />
              <fieldset className="rounded-xl border border-border p-2">
                <legend className="px-1 text-sm font-medium">{t('cf.visibleRoles')}</legend>
                <p className="mb-1 text-xs text-muted">{t('cf.visibleRolesHint')}</p>
                <div className="grid grid-cols-2 gap-1">
                  {STAFF_ROLES.map((r) => (
                    <Check key={r} label={t(`role.${r}`)} checked={f.visibleRoles.includes(r)} onChange={(v) => setF({ ...f, visibleRoles: v ? [...f.visibleRoles, r] : f.visibleRoles.filter((x) => x !== r) })} />
                  ))}
                </div>
              </fieldset>
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              <Button type="submit" disabled={a.busy}>
                {t('cf.create')}
              </Button>
            </form>
          </Section>
        )}
      </div>
    </div>
  );
}
