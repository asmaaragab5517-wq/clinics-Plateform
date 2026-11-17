import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { AppointmentStatus } from '@hf/shared';
import { Card, Muted, Row, StatusBadge, T, colors } from './ui';
import { portalApi } from '../lib/endpoints';
import { dateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { PortalAppointment, QueuePosition } from '../lib/types';

export const statusTone = (s: AppointmentStatus): 'info' | 'warn' | 'danger' | 'success' =>
  s === 'cancelled' || s === 'no_show' ? 'danger' : s === 'requested' ? 'warn' : s === 'completed' ? 'success' : 'info';

/** Upcoming appointment card; when checked in it polls the queue position every 30 s (FR-APP-1). */
export function AppointmentCard({ a, live = false }: { a: PortalAppointment; live?: boolean }) {
  const { t, locale, pick } = useI18n();
  const [q, setQ] = useState<QueuePosition | null>(null);
  const checkedIn = a.status === 'checked_in' || a.status === 'in_consultation';

  useEffect(() => {
    if (!live || !checkedIn) return;
    let stop = false;
    const tick = () =>
      portalApi
        .queue(a.id)
        .then((r) => !stop && setQ(r))
        .catch(() => undefined);
    void tick();
    const id = setInterval(tick, 30000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [a.id, live, checkedIn]);

  const doctor = pick({ name_ar: a.doctor_name_ar, name_en: a.doctor_name_en });
  const clinic = pick({ name_ar: a.clinic_name_ar, name_en: a.clinic_name_en });
  return (
    <Card
      onPress={() => router.push({ pathname: '/patient/appointments/[id]', params: { id: a.id } })}
      accessibilityLabel={[doctor, a.is_video ? t('tele.title') : null, dateTime(a.start_at, locale), t(`status.${a.status}`)].filter(Boolean).join(', ')}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700', flex: 1 }}>{doctor}</T>
        <StatusBadge label={t(`status.${a.status}`)} tone={statusTone(a.status)} />
      </Row>
      <Muted>{clinic}</Muted>
      {a.is_video ? (
        <Row style={{ alignItems: 'center', marginTop: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.info, marginEnd: 6 }} />
          <T style={{ color: colors.info, fontWeight: '600' }}>{t('tele.title')}</T>
        </Row>
      ) : null}
      <T style={{ marginTop: 6 }}>{dateTime(a.start_at, locale)}</T>
      {checkedIn ? (
        <View style={{ marginTop: 8 }}>
          {a.ticket_number != null ? <T style={{ fontWeight: '700' }}>{`${t('queue.ticket')}: ${a.ticket_number}`}</T> : null}
          {q?.position != null ? <T>{t('queue.position', { position: q.position })}</T> : null}
          {q?.status === 'called' ? <T style={{ fontWeight: '700' }}>{t('queue.yourTurn')}</T> : null}
          {q?.nowServing != null ? <Muted>{`${t('queue.nowServing')}: ${q.nowServing}`}</Muted> : null}
        </View>
      ) : null}
      {a.status === 'requested' && a.checkout_url ? <T style={{ marginTop: 6, fontWeight: '600' }}>{t('payment.pending')}</T> : null}
    </Card>
  );
}
