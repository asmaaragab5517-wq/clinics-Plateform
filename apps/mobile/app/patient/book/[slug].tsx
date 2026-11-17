import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ActionButton, Banner, Button, Card, Chip, ErrorBox, H2, Loading, Muted, Row, Screen, Section, StatusBadge, T, colors, s } from '../../../components/ui';
import { SlotPicker } from '../../../components/SlotPicker';
import { newIdempotencyKey, portalApi, publicApi } from '../../../lib/endpoints';
import { dateTime, money, patientName } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { openCheckout } from '../../../lib/payments';
import { useAction, useQuery } from '../../../lib/useQuery';
import type { Slot } from '../../../lib/types';

type Step = 'service' | 'clinic' | 'slot' | 'patient' | 'payment';

/** Video consultation (services.type 'telemedicine'): always paid online (API: telemedicine_requires_online_payment). */
const isVideoService = (sv: { type?: string | null } | undefined) => sv?.type === 'telemedicine';

/**
 * Booking flow (FR-APP-1, FR-WEB-3): service → clinic (if several) → slot (14 days) → family member → payment.
 * Pay online opens payment.checkout_url (HealthPay hosted checkout) in an auth session that returns on
 * healthflow://book/result (lib/payments.ts); the 10-minute hold
 * is shown. One Idempotency-Key per attempt so a retried tap cannot double-book.
 * Video consultations (telemedicine services) are labelled as such and can only be paid online, as on the site.
 */
export default function Booking() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, pick, locale } = useI18n();
  const doctor = useQuery(slug ? `doctor:${slug}` : null, () => publicApi.doctor(slug!));
  const me = useQuery('portal:me', portalApi.me);
  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [payment, setPayment] = useState<'online' | 'at_clinic'>('at_clinic');
  const [idem, setIdem] = useState(newIdempotencyKey);
  const { busy, error, run } = useAction();

  const d = doctor.data;
  const service = d?.services.find((x) => x.id === serviceId);
  const video = isVideoService(service);
  const mode: 'online' | 'at_clinic' = video ? 'online' : payment;
  const clinics = d?.clinics ?? [];
  const effectiveClinic = clinicId ?? slot?.clinicId ?? (clinics.length === 1 ? clinics[0]!.id : null);
  const price = useMemo(() => {
    const p = service?.prices ?? [];
    return (p.find((x) => x.clinicId === effectiveClinic) ?? p[0])?.price ?? null;
  }, [service, effectiveClinic]);
  const reset = () => setIdem(newIdempotencyKey());

  if ((doctor.loading && !d) || (me.loading && !me.data)) return <Screen><Loading /></Screen>;
  if (!d) return <Screen><ErrorBox error={doctor.error} onRetry={() => void doctor.reload()} /></Screen>;

  const patients = me.data?.patients ?? [];
  const steps: Step[] = clinics.length > 1 ? ['service', 'clinic', 'slot', 'patient', 'payment'] : ['service', 'slot', 'patient', 'payment'];
  const idx = steps.indexOf(step);
  const go = (n: number) => setStep(steps[Math.max(0, Math.min(steps.length - 1, idx + n))]!);
  const canNext = { service: !!serviceId, clinic: !!clinicId, slot: !!slot, patient: !!patientId, payment: true }[step];

  const book = async () => {
    if (!serviceId || !slot || !patientId) return;
    const r = await run(() => portalApi.book({ clinicId: slot.clinicId, doctorId: d.id, serviceId, start: slot.start, patientId, paymentMode: mode }, idem));
    if (!r) return;
    reset();
    if (r.payment?.checkout_url) {
      await openCheckout(r.payment.checkout_url, r.appointment, 'replace');
    } else router.replace({ pathname: '/patient/appointments/[id]', params: { id: r.appointment.id, booked: '1' } });
  };

  const stepTitle = { service: t('booking.step.service'), clinic: t('booking.step.clinic'), slot: t('booking.step.slot'), patient: t('booking.step.patient'), payment: t('booking.step.payment') }[step];

  return (
    <Screen
      footer={
        <Row style={{ gap: 8 }}>
          {idx > 0 ? <Button kind="secondary" title={t('common.back')} onPress={() => go(-1)} style={{ flex: 1 }} /> : null}
          {step === 'payment' ? (
            <ActionButton title={t('booking.confirm')} onPress={() => void book()} loading={busy} style={{ flex: 2 }} />
          ) : (
            <Button title={t('common.next')} onPress={() => go(1)} disabled={!canNext} style={{ flex: 2 }} />
          )}
        </Row>
      }
    >
      <Muted>{[d.title, pick(d)].filter(Boolean).join(' ')}</Muted>
      <H2>{`${idx + 1}/${steps.length} · ${stepTitle}`}</H2>
      <View style={{ height: 12 }} />

      {step === 'service' &&
        d.services.map((sv) => (
          <Card
            key={sv.id}
            onPress={() => { setServiceId(sv.id); setSlot(null); reset(); }}
            accessibilityLabel={[pick(sv), isVideoService(sv) ? t('booking.videoBadge') : null].filter(Boolean).join(', ')}
            style={serviceId === sv.id ? { borderWidth: 2, borderColor: colors.primary } : undefined}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1, fontWeight: '600' }}>{pick(sv)}</T>
              {sv.prices?.[0] ? <T>{money(sv.prices[0].price, locale)}</T> : null}
            </Row>
            <Row style={{ alignItems: 'center' }}>
              <Muted>{t('doctor.minutes', { minutes: sv.duration_minutes })}</Muted>
              {isVideoService(sv) ? <StatusBadge label={t('booking.videoBadge')} tone="info" /> : null}
            </Row>
            {isVideoService(sv) ? <Muted style={{ marginTop: 4 }}>{t('booking.videoNote')}</Muted> : null}
          </Card>
        ))}

      {step === 'clinic' && (
        <View style={s.wrap}>
          {clinics.map((c) => (
            <Chip key={c.id} label={pick(c)} selected={clinicId === c.id} onPress={() => { setClinicId(c.id); setSlot(null); reset(); }} />
          ))}
        </View>
      )}

      {step === 'slot' && serviceId && (
        <SlotPicker doctorId={d.id} serviceId={serviceId} clinicId={clinicId ?? undefined} selected={slot} onSelect={(x) => { setSlot(x); reset(); }} />
      )}

      {step === 'patient' && (
        <Section title={t('booking.whoFor')}>
          {!patients.length ? <Banner kind="info">{t('family.addSelfFirst')}</Banner> : null}
          <View style={s.wrap}>
            {patients.map((p) => (
              <Chip key={p.id} label={`${patientName(p, locale)} (${t(`family.relation.${p.relation}`)})`} selected={patientId === p.id} onPress={() => setPatientId(p.id)} />
            ))}
          </View>
          <Button kind="ghost" title={t('family.add')} onPress={() => router.push('/patient/family')} />
        </Section>
      )}

      {step === 'payment' && slot && (
        <View>
          <Card>
            <Row style={{ alignItems: 'center' }}>
              <T style={{ flex: 1, fontWeight: '600' }}>{service ? pick(service) : ''}</T>
              {video ? <StatusBadge label={t('booking.videoBadge')} tone="info" /> : null}
            </Row>
            <T>{dateTime(slot.start, locale)}</T>
            <Muted>{pick(clinics.find((c) => c.id === slot.clinicId))}</Muted>
            {price != null ? <T style={{ marginTop: 6, fontWeight: '700' }}>{`${t('common.total')}: ${money(price, locale)}`}</T> : null}
          </Card>
          {video ? (
            <Banner kind="info">{t('booking.videoOnlineOnly')}</Banner>
          ) : (
            <View style={s.wrap}>
              <Chip label={t('booking.payAtClinic')} selected={payment === 'at_clinic'} onPress={() => { setPayment('at_clinic'); reset(); }} />
              <Chip label={t('booking.payOnline')} selected={payment === 'online'} onPress={() => { setPayment('online'); reset(); }} />
            </View>
          )}
          {video ? <Muted style={{ marginBottom: 6 }}>{t('booking.videoDoneNote')}</Muted> : null}
          {mode === 'online' ? <Muted>{t('booking.holdExpires', { minutes: 10 })}</Muted> : null}
          <ErrorBox error={error} />
        </View>
      )}
    </Screen>
  );
}
