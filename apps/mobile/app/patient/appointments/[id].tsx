import { useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AppointmentCard } from '../../../components/AppointmentCard';
import { ActionButton, Banner, Button, Empty, ErrorBox, Field, Loading, Muted, Screen, Section, T } from '../../../components/ui';
import { SlotPicker } from '../../../components/SlotPicker';
import { readUpcoming } from '../../../lib/cache';
import { portalApi } from '../../../lib/endpoints';
import { dateTime } from '../../../lib/format';
import { useI18n } from '../../../lib/i18n';
import { useAction, useQuery } from '../../../lib/useQuery';
import type { PortalAppointment, Slot } from '../../../lib/types';

/** There is no GET /v1/portal/appointments/:id, so the detail is looked up in the upcoming + past lists. */
async function findAppointment(id: string): Promise<PortalAppointment | null> {
  const up = await portalApi.appointments('upcoming');
  const hit = up.find((a) => a.id === id);
  if (hit) return hit;
  return (await portalApi.appointments('past')).find((a) => a.id === id) ?? null;
}

export default function AppointmentDetail() {
  const { id, booked } = useLocalSearchParams<{ id: string; booked?: string }>();
  const { t, locale } = useI18n();
  const q = useQuery(id ? `appt:${id}` : null, () => findAppointment(id!), { fallback: async () => (await readUpcoming())?.items.find((a) => a.id === id) ?? null });
  const [panel, setPanel] = useState<'none' | 'cancel' | 'reschedule'>('none');
  const [reason, setReason] = useState('');
  const [slot, setSlot] = useState<Slot | null>(null);
  const act = useAction();

  if (q.loading && !q.data) return <Screen><Loading /></Screen>;
  const a = q.data;
  if (!a) return <Screen><ErrorBox error={q.error} />{!q.error ? <Empty text={t('common.notFound')} /> : null}</Screen>;

  const active = ['requested', 'booked', 'confirmed'].includes(a.status);
  const done = async (msg: string) => {
    setPanel('none');
    await q.reload();
    Alert.alert(msg);
  };

  const cancel = () =>
    Alert.alert(t('appointments.cancelTitle'), t('appointments.cancelConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      { text: t('appointments.cancel'), style: 'destructive', onPress: () => void act.run(async () => { await portalApi.cancel(a.id, reason.trim()); await done(t('appointments.cancelled')); }) },
    ]);

  return (
    <Screen refreshing={q.loading} onRefresh={() => void q.reload()}>
      {booked ? <Banner kind="success">{t('booking.confirmed')}</Banner> : null}
      {q.fromCache ? <Banner kind="warn">{t('offline.cached')}</Banner> : null}
      <AppointmentCard a={a} live={!q.fromCache} />
      <Muted ltr>{`${t('appointments.ref')}: ${a.ref}`}</Muted>
      {a.address_lines ? <T style={{ marginTop: 4 }}>{a.address_lines}</T> : null}
      <ErrorBox error={act.error} />

      {a.status === 'requested' && a.checkout_url ? (
        <ActionButton
          title={t('payment.payNow')}
          onPress={() => void WebBrowser.openBrowserAsync(a.checkout_url!).then(() => router.push({ pathname: '/patient/payment-result', params: { ref: a.ref, id: a.id } }))}
        />
      ) : null}
      {a.status === 'booked' ? <ActionButton title={t('appointments.confirm')} loading={act.busy} onPress={() => void act.run(async () => { await portalApi.confirm(a.id); await done(t('appointments.confirmedMsg')); })} /> : null}
      {a.status === 'completed' ? <Button title={t('review.title')} onPress={() => router.push({ pathname: '/patient/review/[id]', params: { id: a.id } })} /> : null}

      {active ? (
        <>
          <Button kind="secondary" title={t('appointments.reschedule')} onPress={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')} />
          <Button kind="danger" title={t('appointments.cancel')} onPress={() => setPanel(panel === 'cancel' ? 'none' : 'cancel')} />
        </>
      ) : null}

      {panel === 'cancel' ? (
        <Section title={t('appointments.cancelTitle')}>
          <Field label={t('appointments.cancelReason')} value={reason} onChangeText={setReason} multiline maxLength={300} />
          <ActionButton kind="danger" title={t('appointments.cancel')} disabled={reason.trim().length < 2} loading={act.busy} onPress={cancel} />
        </Section>
      ) : null}

      {panel === 'reschedule' ? (
        <Section title={t('appointments.reschedule')}>
          <SlotPicker doctorId={a.doctor_id} clinicId={a.clinic_id} selected={slot} onSelect={setSlot} />
          {slot ? <T style={{ marginVertical: 8 }}>{dateTime(slot.start, locale)}</T> : null}
          <ActionButton
            title={t('common.confirm')}
            disabled={!slot}
            loading={act.busy}
            onPress={() => void act.run(async () => { await portalApi.reschedule(a.id, slot!.start); setSlot(null); await done(t('appointments.rescheduled')); })}
          />
        </Section>
      ) : null}
    </Screen>
  );
}
