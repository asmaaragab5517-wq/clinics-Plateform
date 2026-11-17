'use client';

import { useState } from 'react';
import { decodeNationalId, toWesternDigits } from '@hf/shared';
import { Alert, Button, Field, Input, Select } from '@hf/ui';
import { bff, errorText } from '@/lib/bff';
import { t, tDyn, type Locale } from '@/lib/i18n';

const RELATIONS = ['self', 'child', 'spouse', 'parent', 'sibling', 'other'] as const;
type Relation = (typeof RELATIONS)[number];

/** Self-registration of the account holder or a family member (FR-PAT-4) with mandatory health-data consent. */
export function PatientForm({ locale, hasSelf, phone, onCreated }: { locale: Locale; hasSelf: boolean; phone: string; onCreated: (id: string) => void }) {
  const [relation, setRelation] = useState<Relation>(hasSelf ? 'child' : 'self');
  const [first, setFirst] = useState('');
  const [father, setFather] = useState('');
  const [grandfather, setGrandfather] = useState('');
  const [family, setFamily] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nid, setNid] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [consent, setConsent] = useState(false);
  const [messaging, setMessaging] = useState(true);
  const [nidError, setNidError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onNid(v: string) {
    const clean = toWesternDigits(v).replace(/\D/g, '').slice(0, 14);
    setNid(clean);
    setNidError(null);
    if (clean.length === 14) {
      const r = decodeNationalId(clean);
      if (r.ok) {
        setDob(r.info.dateOfBirth);
        setGender(r.info.gender);
      } else setNidError(t(locale, 'patient.nationalIdInvalid'));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consent) return setError(t(locale, 'booking.consentRequired'));
    if (nid && (nid.length !== 14 || !decodeNationalId(nid, { dateOfBirth: dob, gender: gender || undefined }).ok)) return setNidError(t(locale, 'patient.nationalIdInvalid'));
    if (!first.trim() || !dob || !gender) return setError(t(locale, 'error.validation_failed'));
    setBusy(true);
    try {
      const created = await bff<{ id: string }>('/api/portal/patients', {
        json: {
          relation,
          consentHealthData: true,
          consentMessaging: messaging,
          patient: {
            nameAr: { first: first.trim(), father: father.trim(), grandfather: grandfather.trim(), family: family.trim() },
            ...(nameEn.trim() ? { nameEn: nameEn.trim() } : {}),
            ...(nid ? { nationalId: nid } : {}),
            dateOfBirth: dob,
            gender,
            phones: [{ number: phone, primary: true }],
          },
        },
      });
      onCreated(created.id);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  const relations = RELATIONS.filter((r) => r !== 'self' || !hasSelf);
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label={t(locale, 'patient.relation')} htmlFor="pf-rel">
        <Select id="pf-rel" value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
          {relations.map((r) => (
            <option key={r} value={r}>
              {tDyn(locale, `relation.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t(locale, 'patient.firstName')} htmlFor="pf-first">
          <Input id="pf-first" required dir="auto" autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} />
        </Field>
        <Field label={t(locale, 'patient.fatherName')} htmlFor="pf-father">
          <Input id="pf-father" dir="auto" value={father} onChange={(e) => setFather(e.target.value)} />
        </Field>
        <Field label={t(locale, 'patient.grandfatherName')} htmlFor="pf-gf">
          <Input id="pf-gf" dir="auto" value={grandfather} onChange={(e) => setGrandfather(e.target.value)} />
        </Field>
        <Field label={t(locale, 'patient.familyName')} htmlFor="pf-family">
          <Input id="pf-family" dir="auto" autoComplete="family-name" value={family} onChange={(e) => setFamily(e.target.value)} />
        </Field>
      </div>
      <Field label={`${t(locale, 'patient.nameEn')} (${t(locale, 'site.optional')})`} htmlFor="pf-en">
        <Input id="pf-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label={t(locale, 'patient.nationalId')} htmlFor="pf-nid" hint={t(locale, 'patient.nationalIdHint')} error={nidError}>
        <Input id="pf-nid" inputMode="numeric" dir="ltr" className="num text-start" maxLength={20} value={nid} onChange={(e) => onNid(e.target.value)} aria-invalid={!!nidError} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t(locale, 'patient.dob')} htmlFor="pf-dob">
          <Input id="pf-dob" type="date" required value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t(locale, 'patient.gender')}</legend>
          <div className="flex h-10 items-center gap-4">
            {(['male', 'female'] as const).map((g) => (
              <label key={g} className="inline-flex items-center gap-1">
                <input type="radio" name="pf-gender" value={g} checked={gender === g} onChange={() => setGender(g)} required />
                {t(locale, `patient.${g}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} required aria-required />
        <span>
          {t(locale, 'booking.consentHealth')}{' '}
          <a href={`/${locale}/privacy`} target="_blank" rel="noopener" className="link">
            {t(locale, 'privacy.title')}
          </a>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={messaging} onChange={(e) => setMessaging(e.target.checked)} />
        <span>{t(locale, 'booking.consentMessaging')}</span>
      </label>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={busy || !consent}>
        {busy ? t(locale, 'common.loading') : t(locale, 'booking.savePatient')}
      </Button>
    </form>
  );
}
