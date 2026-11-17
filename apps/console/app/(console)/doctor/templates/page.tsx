'use client';

import { useState } from 'react';
import { Alert, Badge, Bdi, Button, PageHeader } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { IcdSearch } from '@/components/icd-search';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { TEMPLATE_DEFAULT_FIELDS, TEMPLATE_SECTIONS, type EncounterTemplate } from '@/lib/encounters';
import { useApi } from '@/lib/hooks';
import { biName } from '@/lib/format';

const blank = () => ({ nameAr: '', nameEn: '', specialtyId: '', sections: ['chiefComplaint', 'hpi', 'examination', 'diagnoses', 'notes', 'prescriptions', 'followUp'] as string[], defaults: {} as Record<string, string>, dx: [] as { code: string; title: string }[] });

/** FR-EMR-3: the doctor's personal encounter templates (sections shown, default texts, common diagnoses). */
export default function EncounterTemplatesPage() {
  const { t, locale } = useI18n();
  const { me, can } = useSession();
  const toast = useToast();
  const q = useApi<EncounterTemplate[]>('/encounter-templates');
  const specialties = useApi<{ id: string; name_ar: string; name_en: string }[]>('/specialties');
  const [f, setF] = useState(blank);
  const a = useAction();
  const toggle = (s: string, on: boolean) => setF({ ...f, sections: on ? [...f.sections, s] : f.sections.filter((x) => x !== s) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.encTemplates')} subtitle={t('tpl.subtitle')} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Section title={t('tpl.list')} className="xl:col-span-2">
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <ul className="flex flex-col gap-2">
                {rows.map((x) => (
                  <li key={x.id} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{biName(x, locale)}</strong>
                      <Badge tone={x.doctor_id === me.userId ? 'primary' : 'neutral'}>{x.doctor_id ? t('tpl.personal') : t('tpl.shared')}</Badge>
                      {x.sections.includes('dentalChart') && <Badge tone="success">{t('dental.title')}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted">{x.sections.map((s) => t(`enc.section.${s}`)).join(t('common.listSep'))}</p>
                    {x.common_diagnoses.length > 0 && (
                      <p className="mt-1 text-xs">
                        {t('tpl.commonDx')}: <Bdi className="num">{x.common_diagnoses.join(', ')}</Bdi>
                      </p>
                    )}
                    {Object.keys(x.defaults ?? {}).length > 0 && <p className="mt-1 text-xs text-muted">{t('tpl.defaultsFor', { fields: Object.keys(x.defaults).map((k) => t(`enc.section.${k}`)).join(t('common.listSep')) })}</p>}
                  </li>
                ))}
              </ul>
            )}
          </DataState>
          <p className="mt-2 text-xs text-muted">{t('tpl.noEditGap')}</p>
        </Section>
        {can('emr:edit') && (
          <Section title={t('tpl.new')} className="xl:col-span-3">
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!f.sections.length) return a.setError(t('tpl.sectionsRequired'));
                const defaults = Object.fromEntries(Object.entries(f.defaults).filter(([k, v]) => v.trim() && f.sections.includes(k)));
                const r = await a.run(() =>
                  post('/encounter-templates', { nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), specialtyId: f.specialtyId || undefined, sections: f.sections, defaults, commonDiagnoses: f.dx.map((d) => d.code), personal: true }),
                );
                if (r) {
                  toast(t('common.saved'));
                  setF(blank());
                  q.reload();
                }
              }}
            >
              <div className="grid gap-3 md:grid-cols-3">
                <TextField label={t('cat.nameAr')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required minLength={2} dir="rtl" lang="ar" />
                <TextField label={t('cat.nameEn')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" lang="en" />
                <SelectField label={t('tpl.specialty')} value={f.specialtyId} placeholder={t('tpl.anySpecialty')} onChange={(e) => setF({ ...f, specialtyId: e.target.value })} options={(specialties.data ?? []).map((s) => ({ value: s.id, label: biName(s, locale) }))} />
              </div>
              <fieldset className="rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t('tpl.sections')}</legend>
                <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
                  {TEMPLATE_SECTIONS.map((s) => (
                    <Check key={s} label={t(`enc.section.${s}`)} checked={f.sections.includes(s)} onChange={(v) => toggle(s, v)} />
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t('tpl.defaults')}</legend>
                <p className="text-xs text-muted">{t('tpl.defaultsHint')}</p>
                {TEMPLATE_DEFAULT_FIELDS.filter((k) => f.sections.includes(k)).map((k) => (
                  <TextAreaField key={k} label={t(`enc.section.${k}`)} value={f.defaults[k] ?? ''} rows={2} onChange={(e) => setF({ ...f, defaults: { ...f.defaults, [k]: e.target.value } })} dir="auto" />
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t('tpl.commonDx')}</legend>
                <IcdSearch onAdd={(code, title) => !f.dx.some((d) => d.code === code) && setF({ ...f, dx: [...f.dx, { code, title }] })} />
                <ul className="flex flex-wrap gap-1">
                  {f.dx.map((d) => (
                    <li key={d.code} className="flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-xs">
                      <Bdi className="num font-medium">{d.code}</Bdi>
                      <span className="max-w-40 truncate">{d.title}</span>
                      <button type="button" className="text-muted hover:text-danger" aria-label={`${t('common.remove')} ${d.code}`} onClick={() => setF({ ...f, dx: f.dx.filter((x) => x.code !== d.code) })}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
              {a.error && <Alert tone="danger">{a.error}</Alert>}
              <Button type="submit" className="self-start" disabled={a.busy}>
                {t('tpl.create')}
              </Button>
            </form>
          </Section>
        )}
      </div>
    </div>
  );
}
