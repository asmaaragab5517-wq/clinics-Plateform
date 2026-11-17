'use client';

import { useState } from 'react';
import { GOVERNORATES, decodeNationalId, normalisePhone, toWesternDigits } from '@hf/shared';
import { Alert, Bdi, Button } from '@hf/ui';
import { Dialog } from './dialog';
import { ApiError, post } from '@/lib/api';
import { ageFrom, isoDate, patientName } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { Check, SelectField, TextField } from './common';
import { CustomFieldInputs, customFieldsPayload, useCustomFields, validateCustomFields, type CustomValues } from './custom-fields';
import { useI18n } from './i18n';
import { PatientSearch } from './patient-search';

interface Duplicate {
  id: string;
  mrn: string;
  name: string;
  date_of_birth: string;
  reason: 'national_id' | 'phone' | 'name_dob';
  score: number;
}

const EMPTY = {
  first: '',
  father: '',
  grandfather: '',
  family: '',
  nameEn: '',
  nationalId: '',
  dob: '',
  gender: '' as '' | 'male' | 'female',
  phone: '',
  email: '',
  governorate: '',
  city: '',
  address: '',
};

/** Register a patient (FR-PAT-1/2/5): National ID decode fills DOB and gender; duplicates come back as 409. */
export function RegisterPatientDialog({ open, onClose, onCreated, onUseExisting }: { open: boolean; onClose: () => void; onCreated: (p: { id: string; mrn: string }) => void; onUseExisting: (id: string) => void }) {
  const { t, locale, err } = useI18n();
  const [f, setF] = useState(EMPTY);
  const [consents, setConsents] = useState({ healthData: true, messaging: true, marketing: false });
  const [guardian, setGuardian] = useState<PatientRow | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [nidInfo, setNidInfo] = useState<string | null>(null);
  const [dups, setDups] = useState<Duplicate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { defs: cfDefs } = useCustomFields();
  const [custom, setCustom] = useState<CustomValues>({});
  const [cfErrors, setCfErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof EMPTY, v: string) => setF((x) => ({ ...x, [k]: v }));
  const age = ageFrom(f.dob);
  const minor = age !== null && age < 18;

  function onNid(raw: string) {
    const v = toWesternDigits(raw).replace(/\D/g, '').slice(0, 14);
    set('nationalId', v);
    if (v.length !== 14) {
      setNidInfo(null);
      return;
    }
    const r = decodeNationalId(v);
    if (r.ok) {
      const gov = GOVERNORATES.find((g) => g.code === r.info.governorateCode);
      setF((x) => ({ ...x, nationalId: v, dob: r.info.dateOfBirth, gender: r.info.gender, governorate: x.governorate || (gov?.slug ?? '') }));
      setErrors((e) => ({ ...e, nationalId: '' }));
      setNidInfo(t('pat.nidDecoded', { dob: r.info.dateOfBirth, gender: t(`patient.${r.info.gender}`), gov: gov ? (locale === 'ar' ? gov.ar : gov.en) : t('pat.bornAbroad') }));
    } else {
      setNidInfo(null);
      setErrors((e) => ({ ...e, nationalId: t(`pat.nidError.${r.error}`) }));
    }
  }

  async function submit(force: boolean) {
    const e: Record<string, string> = {};
    if (!f.first.trim()) e.first = t('form.required');
    if (!f.dob) e.dob = t('form.required');
    if (!f.gender) e.gender = t('form.required');
    const phone = normalisePhone(f.phone);
    if (!phone) e.phone = t('err.invalid_phone');
    if (f.nationalId) {
      const r = decodeNationalId(f.nationalId, { dateOfBirth: f.dob || undefined, gender: f.gender || undefined });
      if (!r.ok) e.nationalId = t(`pat.nidError.${r.error}`);
    }
    if (minor && !guardian) e.guardian = t('err.guardian_required_for_minor');
    setErrors(e);
    // Files can only be attached once the patient exists (they are stored as patient documents).
    const ce = validateCustomFields(cfDefs, custom, t, { skipFiles: true });
    setCfErrors(ce);
    if (Object.values(e).some(Boolean) || Object.keys(ce).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const gov = GOVERNORATES.find((g) => g.slug === f.governorate);
      const created = await post<{ id: string; mrn: string }>('/patients', {
        force,
        consents,
        patient: {
          nameAr: { first: f.first.trim(), father: f.father.trim(), grandfather: f.grandfather.trim(), family: f.family.trim() },
          nameEn: f.nameEn.trim() || undefined,
          nationalId: f.nationalId || undefined,
          dateOfBirth: f.dob,
          gender: f.gender,
          phones: [{ number: phone, primary: true }],
          email: f.email.trim() || undefined,
          governorate: gov ? gov.ar : undefined,
          city: f.city.trim() || undefined,
          address: f.address.trim() || undefined,
          guardianPatientId: minor ? guardian?.id : undefined,
          customFields: customFieldsPayload(cfDefs.filter((d) => d.type !== 'file'), custom, { dropEmpty: true }),
        },
      });
      setF(EMPTY);
      setCustom({});
      setGuardian(null);
      setDups(null);
      setNidInfo(null);
      onCreated(created);
    } catch (x) {
      if (x instanceof ApiError && x.code === 'possible_duplicate' && Array.isArray(x.details)) setDups(x.details as Duplicate[]);
      else if (x instanceof ApiError && x.code === 'validation_failed' && Array.isArray(x.details)) {
        const fe: Record<string, string> = {};
        for (const d of x.details as { path: string; message: string }[]) {
          const key = d.path.includes('nationalId') ? 'nationalId' : d.path.includes('phones') ? 'phone' : d.path.includes('dateOfBirth') ? 'dob' : d.path.includes('nameAr') ? 'first' : 'form';
          fe[key] = d.message.startsWith('national_id_') ? t(`pat.nidError.${d.message.replace('national_id_', '')}`) : d.message === 'invalid_phone' ? t('err.invalid_phone') : t('err.validation_failed');
        }
        setErrors(fe);
        if (fe.form) setFormError(fe.form);
      } else setFormError(err(x));
    } finally {
      setBusy(false);
    }
  }

  const govOptions = GOVERNORATES.map((g) => ({ value: g.slug, label: locale === 'ar' ? g.ar : g.en }));
  const cities = GOVERNORATES.find((g) => g.slug === f.governorate)?.cities ?? [];

  return (
    <>
      <Dialog open={open && !dups} onClose={onClose} title={t('pat.register')}>
        <form
          className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('pat.first')} value={f.first} onChange={(e) => set('first', e.target.value)} error={errors.first} required dir="auto" autoFocus />
            <TextField label={t('pat.father')} value={f.father} onChange={(e) => set('father', e.target.value)} dir="auto" />
            <TextField label={t('pat.grandfather')} value={f.grandfather} onChange={(e) => set('grandfather', e.target.value)} dir="auto" />
            <TextField label={t('pat.family')} value={f.family} onChange={(e) => set('family', e.target.value)} dir="auto" />
          </div>
          <TextField label={t('pat.nameEn')} value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" />
          <TextField label={t('patient.nationalId')} value={f.nationalId} onChange={(e) => onNid(e.target.value)} inputMode="numeric" dir="ltr" error={errors.nationalId} hint={nidInfo ?? t('pat.nidHint')} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('patient.dob')} type="date" value={f.dob} onChange={(e) => set('dob', e.target.value)} error={errors.dob} required />
            <SelectField
              label={t('patient.gender')}
              value={f.gender}
              onChange={(e) => set('gender', e.target.value)}
              error={errors.gender}
              placeholder={t('form.choose')}
              options={[
                { value: 'male', label: t('patient.male') },
                { value: 'female', label: t('patient.female') },
              ]}
            />
          </div>
          <TextField label={t('pat.phone')} value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" dir="ltr" error={errors.phone} hint={t('pat.phoneHint')} required />
          <TextField label={t('pat.email')} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} dir="ltr" />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('pat.governorate')} value={f.governorate} onChange={(e) => set('governorate', e.target.value)} options={govOptions} placeholder={t('form.choose')} />
            <SelectField label={t('pat.city')} value={f.city} onChange={(e) => set('city', e.target.value)} options={cities.map((c) => ({ value: c.ar, label: locale === 'ar' ? c.ar : c.en }))} placeholder={t('form.choose')} />
          </div>
          <TextField label={t('pat.address')} value={f.address} onChange={(e) => set('address', e.target.value)} dir="auto" />
          {minor && (
            <div className="flex flex-col gap-2 rounded-xl border border-warning/40 p-3">
              <p className="text-sm text-warning">{t('pat.minorGuardian')}</p>
              {guardian ? (
                <div className="flex items-center justify-between text-sm">
                  <Bdi>{patientName(guardian, locale)}</Bdi>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setGuardian(null)}>
                    {t('common.change')}
                  </Button>
                </div>
              ) : (
                <PatientSearch id="guardian-search" compact onSelect={setGuardian} />
              )}
              {errors.guardian && (
                <p role="alert" className="text-xs text-danger">
                  {errors.guardian}
                </p>
              )}
            </div>
          )}
          <CustomFieldInputs defs={cfDefs} values={custom} onChange={setCustom} errors={cfErrors} />
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t('pat.consents')}</legend>
            <Check label={t('privacy.consent')} hint={t('pat.consentHealthHint')} checked={consents.healthData} onChange={(v) => setConsents({ ...consents, healthData: v })} />
            <Check label={t('pat.consentMessaging')} checked={consents.messaging} onChange={(v) => setConsents({ ...consents, messaging: v })} />
            <Check label={t('pat.consentMarketing')} checked={consents.marketing} onChange={(v) => setConsents({ ...consents, marketing: v })} />
            {!consents.healthData && <Alert tone="warning">{t('pat.noHealthConsent')}</Alert>}
          </fieldset>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={!!dups} onClose={() => setDups(null)} title={t('pat.duplicateTitle')}>
        <div className="flex flex-col gap-3">
          <Alert tone="warning">{t('pat.duplicateBody')}</Alert>
          <ul className="flex flex-col gap-2">
            {(dups ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-border p-2 text-sm">
                <span className="flex flex-col">
                  <Bdi className="font-medium">{d.name}</Bdi>
                  <span className="text-xs text-muted">
                    <Bdi className="num">{d.mrn}</Bdi> · <span className="num">{isoDate(d.date_of_birth)}</span> · {t(`pat.dupReason.${d.reason}`)}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setDups(null);
                    onUseExisting(d.id);
                  }}
                >
                  {t('pat.useExisting')}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDups(null)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setDups(null);
                void submit(true);
              }}
            >
              {t('pat.createAnyway')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
