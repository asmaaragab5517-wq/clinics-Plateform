'use client';

import { useState } from 'react';
import { ARABIC_WEEKDAYS, WEEK_ORDER } from '@hf/shared/datetime';
import { GOVERNORATES } from '@hf/shared/egypt/governorates';
import { Alert, Badge, Bdi, Button, PageHeader, Table } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch, post } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { asciiDigits, biName } from '@/lib/format';

interface ClinicRow {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  governorate: string;
  city: string;
  address_lines: string;
  /** numeric columns; may arrive as strings. */
  lat: number | string | null;
  lng: number | string | null;
  phones: string[];
  email: string | null;
  working_hours: { weekday: number; open: string; close: string }[];
  colours: { primary?: string };
  invoice_footer: string;
  is_public: boolean;
  is_active: boolean;
  legal_entity_id: string | null;
  specialty_ids: string[];
}

const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const empty = () => ({
  ar: '',
  en: '',
  slug: '',
  governorate: 'cairo',
  city: '',
  addressLines: '',
  lat: '',
  lng: '',
  phones: '',
  email: '',
  hours: Object.fromEntries(WEEK_ORDER.map((d) => [d, d === 5 ? { on: false, open: '10:00', close: '22:00' } : { on: true, open: '10:00', close: '22:00' }])) as Record<number, { on: boolean; open: string; close: string }>,
  primary: '#0f766e',
  invoiceFooter: '',
  isPublic: true,
  isActive: true,
  legalEntityId: '',
  specialtyIds: [] as string[],
});

/** FR-ORG-1 clinics: names, address, phones, working hours per weekday (Friday off by default), branding, invoice footer. */
export default function ClinicsAdminPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<ClinicRow[]>('/clinics');
  const entities = useApi<{ id: string; name_ar: string; name_en: string }[]>(can('settings:view') ? '/legal-entities' : null);
  const specialties = useApi<{ id: string; name_ar: string; name_en: string }[]>('/specialties');
  const [editing, setEditing] = useState<ClinicRow | null>(null);
  const [f, setF] = useState(empty());
  const a = useAction();
  const start = (c: ClinicRow | null) => {
    setEditing(c);
    if (!c) return setF(empty());
    const hours = empty().hours;
    for (const d of WEEK_ORDER) hours[d] = { on: false, open: '10:00', close: '22:00' };
    for (const h of c.working_hours ?? []) hours[h.weekday] = { on: true, open: h.open, close: h.close };
    setF({ ar: c.name_ar, en: c.name_en, slug: c.slug, governorate: GOVERNORATES.find((g) => g.ar === c.governorate || g.slug === c.governorate)?.slug ?? 'cairo', city: c.city, addressLines: c.address_lines, lat: c.lat === null || c.lat === undefined ? '' : String(c.lat), lng: c.lng === null || c.lng === undefined ? '' : String(c.lng), phones: (c.phones ?? []).join(', '), email: c.email ?? '', hours, primary: c.colours?.primary ?? '#0f766e', invoiceFooter: c.invoice_footer, isPublic: c.is_public, isActive: c.is_active, legalEntityId: c.legal_entity_id ?? '', specialtyIds: c.specialty_ids ?? [] });
  };
  const gov = GOVERNORATES.find((g) => g.slug === f.governorate);
  const pos = parsePosition(f.lat, f.lng);
  const hadPosition = !!editing && editing.lat !== null && editing.lat !== undefined;
  // Emptying both fields of a clinic that has a position removes it (refused while a clock-in radius uses it).
  const clearing = hadPosition && !pos.value && !pos.error;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.clinicsAdmin')} actions={can('clinic:create') ? <Button onClick={() => start(null)}>{t('clin.new')}</Button> : null} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Section title={t('nav.clinicsAdmin')} className="xl:col-span-2">
          <DataState loading={q.loading} error={q.error} data={q.data} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <th>{t('cat.name')}</th>
                    <th>{t('pat.governorate')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={editing?.id === c.id ? 'bg-primary/10' : ''}>
                      <td>
                        {biName(c, locale)}
                        <Bdi className="num block text-xs text-muted">{c.slug}</Bdi>
                      </td>
                      <td>{[c.governorate, c.city].filter(Boolean).join(' / ')}</td>
                      <td>{c.is_active ? <Badge tone="success">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</td>
                      <td>
                        {can('clinic:edit') && (
                          <Button size="sm" variant="ghost" onClick={() => start(c)}>
                            {t('common.edit')}
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
        <Section title={editing ? t('clin.edit') : t('clin.new')} className="xl:col-span-3">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pos.error) return a.setError(t(pos.error));
              const body = {
                name: { ar: f.ar, en: f.en },
                slug: f.slug,
                governorate: gov?.ar ?? f.governorate,
                city: f.city,
                addressLines: f.addressLines,
                ...(pos.value ? { lat: pos.value.lat, lng: pos.value.lng } : clearing ? { clearPosition: true } : {}),
                phones: f.phones.split(/[,\u060C]/).map((x) => x.trim()).filter(Boolean),
                email: f.email || undefined,
                workingHours: WEEK_ORDER.filter((d) => f.hours[d]?.on).map((d) => ({ weekday: d, open: f.hours[d]!.open, close: f.hours[d]!.close })),
                colours: { primary: f.primary },
                invoiceFooter: f.invoiceFooter,
                isPublic: f.isPublic,
                legalEntityId: f.legalEntityId || undefined,
                specialtyIds: f.specialtyIds,
                ...(editing ? { isActive: f.isActive } : {}),
              };
              const r = await a.run(() => (editing ? patch(`/clinics/${editing.id}`, body) : post('/clinics', body)));
              if (r) {
                toast(t('common.saved'));
                q.reload();
              }
            }}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <TextField label={t('cat.nameAr')} value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} required dir="rtl" />
              <TextField label={t('cat.nameEn')} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} dir="ltr" />
              <TextField label={t('staff.slug')} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} pattern="[a-z0-9-]{2,80}" required dir="ltr" />
              <SelectField label={t('pat.governorate')} value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value, city: '' })} options={GOVERNORATES.map((g) => ({ value: g.slug, label: locale === 'ar' ? g.ar : g.en }))} />
              <SelectField label={t('pat.city')} value={f.city} placeholder={t('form.choose')} onChange={(e) => setF({ ...f, city: e.target.value })} options={(gov?.cities ?? []).map((c) => ({ value: c.ar, label: locale === 'ar' ? c.ar : c.en }))} required />
              <TextField label={t('pat.email')} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" />
            </div>
            <TextField label={t('pat.address')} value={f.addressLines} onChange={(e) => setF({ ...f, addressLines: e.target.value })} />
            <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-medium">{t('clin.location')}</legend>
              <p className="text-xs text-muted">{t('clin.locationHint')}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label={t('clin.lat')}
                  value={f.lat}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="30.04442"
                  onChange={(e) => {
                    // A pasted "lat, lng" pair from Google Maps fills both fields.
                    const pair = splitPair(e.target.value);
                    setF(pair ? { ...f, lat: pair[0], lng: pair[1] } : { ...f, lat: e.target.value });
                  }}
                  error={pos.field === 'lat' ? t(pos.error!) : undefined}
                />
                <TextField label={t('clin.lng')} value={f.lng} inputMode="decimal" dir="ltr" placeholder="31.23571" onChange={(e) => setF({ ...f, lng: e.target.value })} error={pos.field === 'lng' ? t(pos.error!) : undefined} />
              </div>
              {pos.value && !pos.inEgypt && <Alert tone="warning">{t('clin.locationOutsideEgypt')}</Alert>}
              {pos.value && (
                <a className="self-start text-sm text-primary underline" href={`https://www.google.com/maps?q=${pos.value.lat},${pos.value.lng}`} target="_blank" rel="noopener noreferrer">
                  {t('clin.locationCheck')}
                </a>
              )}
              {clearing ? <Alert tone="warning">{t('clin.locationClear')}</Alert> : hadPosition && <p className="text-xs text-muted">{t('clin.locationKeep')}</p>}
              {editing && (editing.lat === null || editing.lat === undefined) && <p className="text-xs text-muted">{t('clin.locationMissing')}</p>}
            </fieldset>
            <TextField label={t('pat.phones')} hint={t('pat.phonesHint')} value={f.phones} onChange={(e) => setF({ ...f, phones: e.target.value })} dir="ltr" />
            <fieldset className="rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-medium">{t('clin.hours')}</legend>
              <div className="grid gap-2 md:grid-cols-2">
                {WEEK_ORDER.map((d) => {
                  const h = f.hours[d]!;
                  return (
                    <div key={d} className="flex items-center gap-2 text-sm">
                      <span className="w-20">
                        <Check label={locale === 'ar' ? (ARABIC_WEEKDAYS[d] ?? '') : (EN_WEEKDAYS[d] ?? '')} checked={h.on} onChange={(v) => setF({ ...f, hours: { ...f.hours, [d]: { ...h, on: v } } })} />
                      </span>
                      <input type="time" className="h-8 rounded-lg border border-border bg-surface px-1" value={h.open} disabled={!h.on} aria-label={t('sch.start')} onChange={(e) => setF({ ...f, hours: { ...f.hours, [d]: { ...h, open: e.target.value } } })} />
                      <input type="time" className="h-8 rounded-lg border border-border bg-surface px-1" value={h.close} disabled={!h.on} aria-label={t('sch.end')} onChange={(e) => setF({ ...f, hours: { ...f.hours, [d]: { ...h, close: e.target.value } } })} />
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('staff.specialties')}</legend>
              <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto md:grid-cols-3">
                {(specialties.data ?? []).map((s) => (
                  <Check key={s.id} label={biName(s, locale)} checked={f.specialtyIds.includes(s.id)} onChange={(c) => setF({ ...f, specialtyIds: c ? [...f.specialtyIds, s.id] : f.specialtyIds.filter((x) => x !== s.id) })} />
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 md:grid-cols-3">
              <SelectField label={t('nav.entities')} value={f.legalEntityId} placeholder={t('form.none')} onChange={(e) => setF({ ...f, legalEntityId: e.target.value })} options={(entities.data ?? []).map((x) => ({ value: x.id, label: biName(x, locale) }))} />
              <TextField label={t('clin.colour')} type="color" value={f.primary} onChange={(e) => setF({ ...f, primary: e.target.value })} />
              <div className="flex flex-col justify-end gap-1">
                <Check label={t('clin.public')} checked={f.isPublic} onChange={(v) => setF({ ...f, isPublic: v })} />
                {editing && <Check label={t('common.active')} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />}
              </div>
            </div>
            <TextAreaField label={t('clin.footer')} value={f.invoiceFooter} onChange={(e) => setF({ ...f, invoiceFooter: e.target.value })} rows={2} />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy || (!editing && !can('clinic:create'))} className="self-start">
              {t('common.save')}
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}

const ascii = asciiDigits;

/** "30.04442, 31.23571" (as Google Maps copies a dropped pin) split into its two numbers, or null. */
function splitPair(v: string): [string, string] | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\u060C\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ascii(v));
  return m ? [m[1]!, m[2]!] : null;
}

/**
 * Clinic map position for the clock-in radius rule. Both numbers or neither; the API accepts any position on Earth,
 * so a position outside Egypt (latitude 22–32, longitude 24–37) is a warning, not an error.
 */
function parsePosition(latIn: string, lngIn: string): { value: { lat: number; lng: number } | null; inEgypt: boolean; error: string | null; field: 'lat' | 'lng' | null } {
  const la = ascii(latIn);
  const ln = ascii(lngIn);
  if (!la && !ln) return { value: null, inEgypt: true, error: null, field: null };
  const re = /^-?\d+(\.\d+)?$/;
  if (!la || !re.test(la) || Math.abs(Number(la)) > 90) return { value: null, inEgypt: true, error: 'clin.latInvalid', field: 'lat' };
  if (!ln || !re.test(ln) || Math.abs(Number(ln)) > 180) return { value: null, inEgypt: true, error: 'clin.lngInvalid', field: 'lng' };
  const lat = Number(la);
  const lng = Number(ln);
  return { value: { lat, lng }, inEgypt: lat >= 22 && lat <= 32 && lng >= 24 && lng <= 37, error: null, field: null };
}
