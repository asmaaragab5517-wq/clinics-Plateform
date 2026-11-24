'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, formatTime12 } from '@hf/shared/datetime';
import { Alert, Badge, Bdi, Button, Card, Spinner, cx } from '@hf/ui';
import { BffError, bff, clearSession, errorText, loadSession, newIdempotencyKey, newUuid, saveSession, trackFunnel } from '@/lib/bff';
import { dateTime, doctorPhotoSrc, doctorTitle, money, nameOf, nextAvailableText, num } from '@/lib/format';
import { t, type Locale } from '@/lib/i18n';
import type { BookingResult, Clinic, Doctor, DoctorDetail, Named, PortalMe, PublicOrg, Slot, Specialty } from '@/lib/types';
import { OtpSignIn } from '../portal/OtpSignIn';
import { DoctorPhoto } from '../site/DoctorPhoto';
import { NextAvailable } from '../site/bits';
import { PatientForm } from '../portal/PatientForm';
import { SlotPicker } from '../portal/SlotPicker';
import { mmss, patientName, useBffData, useNow } from '../portal/hooks';

const STORE_KEY = 'hf.booking.v1';
const STEPS = ['doctor', 'service', 'slot', 'patient', 'payment', 'done'] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;

interface State {
  v: 1;
  step: Step;
  clinicId?: string;
  specialty?: string;
  doctorSlug?: string;
  doctorId?: string;
  doctor?: Named;
  serviceId?: string;
  service?: Named;
  price?: number | null;
  slot?: Slot;
  patientId?: string;
  patientLabel?: string;
  paymentMode?: 'online' | 'at_clinic';
  /** The chosen service is a video consultation (services.type = 'telemedicine'): online payment only. */
  video?: boolean;
  idemKey?: string;
  result?: BookingResult;
  /** One anonymous funnel session per wizard run (FR-WEB-3 abandoned-booking tracking). */
  funnelId?: string;
}

const EMPTY: State = { v: 1, step: 0 };

export const isVideoService = (s: { type?: string | null }) => s.type === 'telemedicine';

function servicePrice(s: DoctorDetail['services'][number], clinicId?: string): number | null {
  const prices = s.prices ?? [];
  return (prices.find((p) => p.clinicId === clinicId) ?? prices.find((p) => p.clinicId === null) ?? prices[0])?.price ?? null;
}

function safeCheckoutUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** FR-WEB-3 booking wizard: doctor → service → slot → patient → payment → confirmation. Resumable via sessionStorage. */
export function BookingWizard({ locale, clinics, specialties, initial }: { locale: Locale; clinics: Clinic[]; specialties: Specialty[]; initial: { doctor?: string; clinic?: string; specialty?: string } }) {
  const [s, setS] = useState<State>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore progress; an explicit doctor/clinic in the URL starts a fresh booking for it.
  useEffect(() => {
    const saved = loadSession<State>(STORE_KEY);
    const fromUrl = initial.doctor || initial.clinic || initial.specialty;
    if (saved?.v === 1 && (!fromUrl || (initial.doctor && saved.doctorSlug === initial.doctor))) {
      setS({ ...saved, funnelId: saved.funnelId ?? newUuid() });
      if (saved.step > 0) setResumed(true);
    } else if (fromUrl) {
      setS({ ...EMPTY, clinicId: initial.clinic, specialty: initial.specialty, doctorSlug: initial.doctor, step: initial.doctor ? 1 : 0, funnelId: newUuid() });
    } else {
      setS({ ...EMPTY, funnelId: newUuid() });
    }
    setHydrated(true);
  }, [initial.doctor, initial.clinic, initial.specialty]);

  useEffect(() => {
    if (hydrated) saveSession(STORE_KEY, s);
  }, [s, hydrated]);

  // Report each step reached, once per step and wizard session (best-effort; the API keeps the furthest step).
  const tracked = useRef('');
  useEffect(() => {
    if (!hydrated || !s.funnelId) return;
    const step = STEPS[s.step]!;
    const key = `${s.funnelId}:${step}`;
    if (tracked.current === key) return;
    tracked.current = key;
    trackFunnel({ sessionId: s.funnelId, step, doctorId: s.doctorId, clinicId: s.clinicId, appointmentId: s.step === 5 ? s.result?.appointment.id : undefined });
  }, [hydrated, s.funnelId, s.step, s.doctorId, s.clinicId, s.result]);

  const update = useCallback((patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch })), []);
  const go = useCallback((step: Step) => {
    setError(null);
    setS((prev) => ({ ...prev, step }));
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);
  const reset = () => {
    clearSession(STORE_KEY);
    setResumed(false);
    setError(null);
    setS({ ...EMPTY, funnelId: newUuid() });
  };

  if (!hydrated) return <Spinner label={t(locale, 'common.loading')} />;

  return (
    <div className="flex flex-col gap-6">
      <ol className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6 sm:text-sm" aria-label={t(locale, 'booking.progress', { current: s.step + 1, total: STEPS.length })}>
        {STEPS.map((k, i) => (
          <li key={k} aria-current={i === s.step ? 'step' : undefined} className={cx('rounded-lg border px-2 py-1 text-center', i === s.step ? 'border-primary bg-primary/10 font-bold text-primary' : i < s.step ? 'border-success/40 text-success' : 'border-border text-muted')}>
            <span className="num">{i + 1}</span>. {t(locale, `booking.step.${k}`)}
          </li>
        ))}
      </ol>
      {resumed && s.step < 5 && (
        <Alert tone="info">
          <span className="flex flex-wrap items-center justify-between gap-2">
            {t(locale, 'booking.resumed')}
            <button type="button" className="link" onClick={reset}>
              {t(locale, 'booking.startOver')}
            </button>
          </span>
        </Alert>
      )}
      <Card className="p-4 sm:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="mb-4 text-xl font-bold outline-none">
          {t(locale, `booking.step.${STEPS[s.step]!}`)}
        </h2>
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {s.step === 0 && <DoctorStep locale={locale} clinics={clinics} specialties={specialties} s={s} update={update} next={() => go(1)} />}
        {s.step === 1 && <ServiceStep locale={locale} s={s} update={update} back={() => go(0)} next={() => go(2)} />}
        {s.step === 2 && <SlotStep locale={locale} s={s} update={update} back={() => go(1)} next={() => go(3)} />}
        {s.step === 3 && <PatientStep locale={locale} s={s} update={update} back={() => go(2)} next={() => go(4)} />}
        {s.step === 4 && (
          <PaymentStep
            locale={locale}
            s={s}
            update={update}
            back={() => go(3)}
            done={(result) => {
              update({ result });
              go(5);
            }}
            slotTaken={(msg) => {
              update({ slot: undefined, idemKey: undefined });
              go(2);
              setError(msg);
            }}
          />
        )}
        {s.step === 5 && s.result && <DoneStep locale={locale} s={s} reset={reset} />}
      </Card>
    </div>
  );
}

type StepProps = { locale: Locale; s: State; update: (p: Partial<State>) => void };

function Nav({ locale, back, next, nextDisabled, nextLabel }: { locale: Locale; back?: () => void; next?: () => void; nextDisabled?: boolean; nextLabel?: string }) {
  return (
    <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-border pt-4">
      {back ? (
        <Button type="button" variant="secondary" onClick={back}>
          {t(locale, 'common.back')}
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button type="button" onClick={next} disabled={nextDisabled}>
          {nextLabel ?? t(locale, 'common.next')}
        </Button>
      )}
    </div>
  );
}

function DoctorStep({ locale, clinics, specialties, s, update, next }: StepProps & { clinics: Clinic[]; specialties: Specialty[]; next: () => void }) {
  const qs = new URLSearchParams();
  if (s.specialty) qs.set('specialty', s.specialty);
  if (s.clinicId) qs.set('clinicId', s.clinicId);
  const { data: doctors, loading, error } = useBffData<Doctor[]>(`/api/public/doctors?${qs}`, locale, { redirectOn401: false });
  const selectCls = 'h-10 w-full rounded-xl border border-border bg-surface px-3';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="bw-clinic" className="text-sm font-medium">
            {t(locale, 'booking.clinic')}
          </label>
          <select id="bw-clinic" className={selectCls} value={s.clinicId ?? ''} onChange={(e) => update({ clinicId: e.target.value || undefined, doctorSlug: undefined, doctorId: undefined })}>
            <option value="">{t(locale, 'booking.anyClinic')}</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {nameOf(locale, c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bw-spec" className="text-sm font-medium">
            {t(locale, 'booking.specialty')}
          </label>
          <select id="bw-spec" className={selectCls} value={s.specialty ?? ''} onChange={(e) => update({ specialty: e.target.value || undefined, doctorSlug: undefined, doctorId: undefined })}>
            <option value="">{t(locale, 'booking.anySpecialty')}</option>
            {specialties.map((sp) => (
              <option key={sp.id} value={sp.slug}>
                {nameOf(locale, sp)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 font-medium">{t(locale, 'booking.chooseDoctor')}</legend>
        {loading ? (
          <Spinner label={t(locale, 'common.loading')} />
        ) : error ? (
          <Alert>{errorText(locale, error)}</Alert>
        ) : !doctors?.length ? (
          <p className="text-muted">{t(locale, 'booking.noDoctors')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {doctors.map((d) => {
              const checked = s.doctorSlug === d.slug;
              return (
                <li key={d.id}>
                  <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3', checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary')}>
                    <input type="radio" name="bw-doctor" className="mt-1" checked={checked} onChange={() => update({ doctorSlug: d.slug, doctorId: d.id, doctor: { name_ar: d.name_ar, name_en: d.name_en }, serviceId: undefined, service: undefined, video: undefined, slot: undefined })} />
                    <DoctorPhoto name={nameOf(locale, d)} src={doctorPhotoSrc(d)} />
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <Bdi className="font-medium">{nameOf(locale, d)}</Bdi>
                      <span className="text-sm text-muted">{[doctorTitle(locale, d.title), ...d.specialties.map((x) => nameOf(locale, x))].filter(Boolean).join(' · ')}</span>
                      {num(d.fee) !== null && <span className="num text-sm">{money(num(d.fee), locale)}</span>}
                      <NextAvailable iso={d.next_available} locale={locale} />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <Nav locale={locale} next={next} nextDisabled={!s.doctorSlug} />
    </div>
  );
}

function ServiceStep({ locale, s, update, back, next }: StepProps & { back: () => void; next: () => void }) {
  const { data: d, loading, error } = useBffData<DoctorDetail>(s.doctorSlug ? `/api/public/doctors/${encodeURIComponent(s.doctorSlug)}` : null, locale, { redirectOn401: false });

  // Keep the clinic consistent with the doctor's clinics; a doctor at one clinic needs no choice.
  useEffect(() => {
    if (!d) return;
    const patch: Partial<State> = {};
    if (s.doctorId !== d.id) Object.assign(patch, { doctorId: d.id, doctor: { name_ar: d.name_ar, name_en: d.name_en } });
    if (!s.clinicId || !d.clinics.some((c) => c.id === s.clinicId)) {
      if (d.clinics.length === 1) patch.clinicId = d.clinics[0]!.id;
      else if (s.clinicId) patch.clinicId = undefined;
    }
    if (Object.keys(patch).length) update(patch);
  }, [d, s.doctorId, s.clinicId, update]);

  if (loading) return <Spinner label={t(locale, 'common.loading')} />;
  if (error || !d) return <Alert>{errorText(locale, error)}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Bdi className="font-medium">{nameOf(locale, d)}</Bdi>
        <p className="text-sm">
          <span className="text-muted">{t(locale, 'doctor.nextAvailable')}: </span>
          {d.nextAvailable ? <span className="num font-medium">{nextAvailableText(d.nextAvailable, locale)}</span> : t(locale, 'doctor.noAvailability')}
        </p>
      </div>
      {d.clinics.length > 1 && (
        <fieldset>
          <legend className="mb-2 font-medium">{t(locale, 'booking.chooseClinic')}</legend>
          <div className="flex flex-wrap gap-2">
            {d.clinics.map((c) => (
              <label key={c.id} className={cx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2', s.clinicId === c.id ? 'border-primary bg-primary/5' : 'border-border')}>
                <input type="radio" name="bw-clinic2" checked={s.clinicId === c.id} onChange={() => update({ clinicId: c.id, slot: undefined, price: (() => {
                  const sv = d.services.find((x) => x.id === s.serviceId);
                  return sv ? servicePrice(sv, c.id) : undefined;
                })() })} />
                {nameOf(locale, c)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className="mb-2 font-medium">{t(locale, 'booking.chooseService')}</legend>
        {d.services.length === 0 ? (
          <p className="text-muted">{t(locale, 'booking.noServices')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.services.map((sv) => {
              const price = servicePrice(sv, s.clinicId);
              const checked = s.serviceId === sv.id;
              return (
                <li key={sv.id}>
                  <label className={cx('flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3', checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary')}>
                    <span className="flex items-center gap-3">
                      <input type="radio" name="bw-service" checked={checked} aria-describedby={isVideoService(sv) ? `bw-video-${sv.id}` : undefined} onChange={() => update({ serviceId: sv.id, service: { name_ar: sv.name_ar, name_en: sv.name_en }, price, video: isVideoService(sv), slot: undefined })} />
                      <span>
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {nameOf(locale, sv)}
                          {isVideoService(sv) && <Badge tone="primary">{t(locale, 'booking.videoBadge')}</Badge>}
                        </span>
                        <span className="num text-sm text-muted">{t(locale, 'services.minutes', { minutes: sv.duration_minutes })}</span>
                        {isVideoService(sv) && (
                          <span id={`bw-video-${sv.id}`} className="block text-xs text-muted">
                            {t(locale, 'booking.videoNote')}
                          </span>
                        )}
                      </span>
                    </span>
                    {price !== null && <span className="num font-bold">{money(price, locale)}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <Nav locale={locale} back={back} next={next} nextDisabled={!s.serviceId || !s.clinicId} />
    </div>
  );
}

function SlotStep({ locale, s, update, back, next }: StepProps & { back: () => void; next: () => void }) {
  if (!s.doctorId) return <Nav locale={locale} back={back} />;
  return (
    <div>
      <SlotPicker locale={locale} doctorId={s.doctorId} clinicId={s.clinicId} serviceId={s.serviceId} value={s.slot?.start} onChange={(slot) => update({ slot, idemKey: newIdempotencyKey(), result: undefined })} />
      {s.slot && (
        <p className="mt-4 text-sm" aria-live="polite">
          {t(locale, 'booking.when')}: <span className="num font-bold">{dateTime(s.slot.start, locale)}</span>
        </p>
      )}
      <Nav locale={locale} back={back} next={next} nextDisabled={!s.slot} />
    </div>
  );
}

function PatientStep({ locale, s, update, back, next }: StepProps & { back: () => void; next: () => void }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const me = useBffData<PortalMe>(signedIn ? '/api/portal/me' : null, locale, { redirectOn401: false });

  useEffect(() => {
    bff<{ signedIn: boolean }>('/api/auth/session')
      .then((r) => setSignedIn(r.signedIn))
      .catch(() => setSignedIn(false));
  }, []);
  useEffect(() => {
    if (me.error instanceof BffError && me.error.code === 'unauthorized') setSignedIn(false);
  }, [me.error]);

  const patients = me.data?.patients ?? [];
  const choose = (id: string) => {
    const p = patients.find((x) => x.id === id);
    update({ patientId: id, patientLabel: p ? patientName(p, locale) : undefined });
  };
  useEffect(() => {
    // Drop a stored patient that no longer belongs to the signed-in account.
    if (me.data && s.patientId && !me.data.patients.some((p) => p.id === s.patientId)) update({ patientId: undefined, patientLabel: undefined });
  }, [me.data, s.patientId, update]);

  if (signedIn === null) return <Spinner label={t(locale, 'common.loading')} />;
  if (!signedIn)
    return (
      <div className="max-w-md">
        <p className="mb-4 text-muted">{t(locale, 'booking.signInToContinue')}</p>
        <OtpSignIn locale={locale} onSignedIn={() => setSignedIn(true)} />
        <Nav locale={locale} back={back} />
      </div>
    );
  if (me.loading && !me.data) return <Spinner label={t(locale, 'common.loading')} />;
  if (me.error && !me.data) return <Alert>{errorText(locale, me.error)}</Alert>;

  const showForm = adding || patients.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {patients.length > 0 && (
        <fieldset>
          <legend className="mb-2 font-medium">{t(locale, 'booking.whoIsPatient')}</legend>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {patients.map((p) => (
              <li key={p.id}>
                <label className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3', s.patientId === p.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary')}>
                  <input type="radio" name="bw-patient" checked={s.patientId === p.id} onChange={() => choose(p.id)} />
                  <span>
                    <Bdi className="block font-medium">{patientName(p, locale)}</Bdi>
                    <span className="text-sm text-muted">{t(locale, `relation.${(['self', 'child', 'spouse', 'parent', 'sibling'] as const).find((r) => r === p.relation) ?? 'other'}`)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {showForm ? (
        <section aria-labelledby="bw-new" className="rounded-xl border border-border p-4">
          <h3 id="bw-new" className="mb-3 font-bold">
            {t(locale, 'booking.newPatient')}
          </h3>
          <PatientForm
            locale={locale}
            phone={me.data?.account.phone ?? ''}
            hasSelf={patients.some((p) => p.relation === 'self')}
            onCreated={async (id) => {
              setAdding(false);
              await me.reload();
              update({ patientId: id });
            }}
          />
        </section>
      ) : (
        <button type="button" className="link self-start" onClick={() => setAdding(true)}>
          + {t(locale, 'booking.addPatient')}
        </button>
      )}
      <Nav locale={locale} back={back} next={next} nextDisabled={!s.patientId} />
    </div>
  );
}

function PaymentStep({ locale, s, update, back, done, slotTaken }: StepProps & { back: () => void; done: (r: BookingResult) => void; slotTaken: (msg: string) => void }) {
  const { data: org } = useBffData<PublicOrg>('/api/public/org', locale, { redirectOn401: false });
  const me = useBffData<PortalMe>('/api/portal/me', locale, { redirectOn401: false });
  // Video consultations are always paid online (API: telemedicine_requires_online_payment).
  const onlineOnly = !!org?.booking?.requireOnlinePayment || !!s.video;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = onlineOnly ? 'online' : s.paymentMode ?? 'online';
  const patient = me.data?.patients.find((p) => p.id === s.patientId);

  async function confirm() {
    if (!s.slot || !s.clinicId || !s.doctorId || !s.serviceId || !s.patientId) return;
    setBusy(true);
    setError(null);
    const idemKey = s.idemKey ?? newIdempotencyKey();
    update({ idemKey, paymentMode: mode });
    try {
      const r = await bff<BookingResult>('/api/portal/bookings', {
        json: { clinicId: s.clinicId, doctorId: s.doctorId, serviceId: s.serviceId, start: s.slot.start, patientId: s.patientId, paymentMode: mode },
        idempotencyKey: idemKey,
      });
      done(r);
    } catch (e) {
      if (e instanceof BffError && (e.code === 'slot_unavailable' || e.status === 409)) slotTaken(errorText(locale, new BffError('slot_unavailable', 409)));
      else setError(errorText(locale, e));
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="col-span-2 font-medium">{value}</dd>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 font-medium">{t(locale, 'booking.paymentMethod')}</legend>
        {onlineOnly && <p className="mb-2 text-sm text-muted">{t(locale, s.video ? 'booking.videoOnlineOnly' : 'booking.onlineRequired')}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          {(['online', 'at_clinic'] as const).map((m) => (
            <label key={m} className={cx('flex flex-1 cursor-pointer items-center gap-2 rounded-xl border p-3', mode === m ? 'border-primary bg-primary/5' : 'border-border', onlineOnly && m === 'at_clinic' && 'cursor-not-allowed opacity-50')}>
              <input type="radio" name="bw-pay" checked={mode === m} disabled={onlineOnly && m === 'at_clinic'} onChange={() => update({ paymentMode: m })} />
              {t(locale, m === 'online' ? 'booking.payOnline' : 'booking.payAtClinic')}
            </label>
          ))}
        </div>
      </fieldset>
      <section aria-labelledby="bw-summary" className="rounded-xl bg-bg p-4">
        <h3 id="bw-summary" className="mb-2 font-bold">
          {t(locale, 'booking.summary')}
        </h3>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {s.doctor && row(t(locale, 'booking.doctor'), <Bdi>{nameOf(locale, s.doctor)}</Bdi>)}
          {s.service &&
            row(
              t(locale, 'booking.service'),
              <span className="flex flex-wrap items-center gap-2">
                {nameOf(locale, s.service)}
                {s.video && <Badge tone="primary">{t(locale, 'booking.videoBadge')}</Badge>}
              </span>,
            )}
          {s.slot && row(t(locale, 'booking.when'), <span className="num">{dateTime(s.slot.start, locale)}</span>)}
          {row(t(locale, 'booking.patient'), <Bdi>{patient ? patientName(patient, locale) : s.patientLabel ?? ''}</Bdi>)}
          {s.price !== undefined && s.price !== null && row(t(locale, 'booking.price'), <span className="num">{money(s.price, locale)}</span>)}
        </dl>
      </section>
      {error && <Alert>{error}</Alert>}
      <Nav locale={locale} back={back} next={() => void confirm()} nextDisabled={busy} nextLabel={busy ? t(locale, 'booking.submitting') : t(locale, 'booking.confirmBooking')} />
    </div>
  );
}

function DoneStep({ locale, s, reset }: { locale: Locale; s: State; reset: () => void }) {
  const r = s.result!;
  const now = useNow();
  const [redirecting, setRedirecting] = useState(false);
  const checkout = safeCheckoutUrl(r.payment?.checkout_url);
  const awaitingPayment = r.appointment.status === 'requested' && !!checkout;
  const holdEnd = r.holdExpiresAt ?? r.appointment.hold_expires_at;
  const left = holdEnd ? new Date(holdEnd).getTime() - now : 0;
  const start = useMemo(() => new Date(r.appointment.start_at), [r.appointment.start_at]);

  const pay = () => {
    if (!checkout) return;
    setRedirecting(true);
    window.location.assign(checkout);
  };

  return (
    <div className="flex flex-col gap-4">
      {awaitingPayment ? (
        left > 0 ? (
          <Alert tone="warning">
            <span className="block">{t(locale, 'booking.awaitingPayment')}</span>
            <span className="block font-bold" role="timer" aria-live="off">
              {t(locale, 'booking.holdCountdown', { time: '' })}
              <span className="num">{mmss(left)}</span>
            </span>
          </Alert>
        ) : (
          <Alert>{t(locale, 'booking.holdExpired')}</Alert>
        )
      ) : (
        <Alert tone="success">{t(locale, 'booking.confirmed')}</Alert>
      )}
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <dt className="text-muted">{t(locale, 'booking.ref')}</dt>
        <dd className="col-span-2">
          <Bdi className="num text-lg font-bold">{r.appointment.ref}</Bdi>
        </dd>
        {s.doctor && (
          <>
            <dt className="text-muted">{t(locale, 'booking.doctor')}</dt>
            <dd className="col-span-2">
              <Bdi>{nameOf(locale, s.doctor)}</Bdi>
            </dd>
          </>
        )}
        <dt className="text-muted">{t(locale, 'booking.when')}</dt>
        <dd className="num col-span-2">{`${formatDate(start)} ${formatTime12(start, locale)}`}</dd>
      </dl>
      {!awaitingPayment && s.paymentMode === 'at_clinic' && !s.video && <p className="text-sm text-muted">{t(locale, 'booking.payAtClinicNote')}</p>}
      {s.video && <Alert tone="info">{t(locale, 'booking.videoDoneNote')}</Alert>}
      <div className="flex flex-wrap gap-2">
        {awaitingPayment && left > 0 && (
          <Button type="button" size="lg" onClick={pay} disabled={redirecting}>
            {redirecting ? t(locale, 'booking.redirecting') : t(locale, 'booking.payNow')}
          </Button>
        )}
        {!awaitingPayment && (
          <a href={`/api/portal/appointments/${encodeURIComponent(r.appointment.id)}/calendar.ics`} download={`${r.appointment.ref}.ics`} className="btn-secondary">
            {t(locale, 'booking.addToCalendar')}
          </a>
        )}
        <a href={`/${locale}/portal/appointments/${encodeURIComponent(r.appointment.id)}`} className="btn-secondary">
          {t(locale, 'booking.viewAppointment')}
        </a>
        <a href={`/${locale}/portal`} className="btn-secondary">
          {t(locale, 'booking.goToAccount')}
        </a>
        <button type="button" className="btn-secondary" onClick={reset}>
          {t(locale, 'booking.bookAnother')}
        </button>
      </div>
    </div>
  );
}
