import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { addDays, localDate } from '@hf/shared';
import { ActionButton, Banner, Button, Card, Chip, Empty, ErrorBox, Loading, Muted, Row, Screen, StatusBadge, T, s } from '../../components/ui';
import { statusTone } from '../../components/AppointmentCard';
import { staffApi } from '../../lib/endpoints';
import { time } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useAction, useQuery } from '../../lib/useQuery';
import type { DoctorVideoVisit, TelemedicineStart } from '../../lib/types';

const STARTABLE = ['booked', 'confirmed', 'checked_in', 'in_consultation'];

/**
 * Doctor video visits (FR-TEL): GET /v1/telemedicine?date= (own visits), Start → host URL in the system browser and
 * the visit's encounter (encounterId from the start response), End → closes the session. Polled every 20 s so
 * "patient waiting" shows up without a manual refresh.
 */
export default function VideoVisits() {
  const { t, locale } = useI18n();
  const [offset, setOffset] = useState(0);
  const day = addDays(localDate(new Date()), offset);
  const list = useQuery(`video:${day}`, () => staffApi.videoVisits(day));
  const [host, setHost] = useState<(TelemedicineStart & { appointmentId: string }) | null>(null);
  const act = useAction();

  useEffect(() => {
    const id = setInterval(() => void list.reload(), 20000);
    return () => clearInterval(id);
  }, [list.reload]);

  const openEncounter = (appointmentId: string, encounterId: string | null) =>
    router.push({ pathname: '/doctor/encounter/[appointmentId]', params: { appointmentId, encounterId: encounterId ?? undefined } });

  const start = (v: DoctorVideoVisit) =>
    void act.run(async () => {
      const r = await staffApi.startVideo(v.appointment_id);
      setHost({ ...r, appointmentId: v.appointment_id });
      await WebBrowser.openBrowserAsync(r.url, { dismissButtonStyle: 'close' });
      await list.reload();
    });

  const end = (v: DoctorVideoVisit) =>
    Alert.alert(t('video.endTitle'), t('video.endBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('video.end'),
        style: 'destructive',
        onPress: () =>
          void act.run(async () => {
            await staffApi.endVideo(v.appointment_id);
            if (host?.appointmentId === v.appointment_id) setHost(null);
            await list.reload();
          }),
      },
    ]);

  return (
    <Screen refreshing={list.loading} onRefresh={() => void list.reload()}>
      <View style={s.wrap}>
        <Chip label={t('video.today')} selected={offset === 0} onPress={() => setOffset(0)} />
        <Chip label={t('video.tomorrow')} selected={offset === 1} onPress={() => setOffset(1)} />
      </View>
      <ErrorBox error={act.error ?? list.error} onRetry={list.error ? () => void list.reload() : undefined} />

      {host ? (
        <Card>
          <Banner kind="success">{t('video.started')}</Banner>
          {host.passcode ? (
            <>
              <Muted>{t('tele.passcode')}</Muted>
              <T ltr selectable style={{ fontSize: 22, fontWeight: '700', letterSpacing: 2 }}>{host.passcode}</T>
            </>
          ) : null}
          <Button kind="secondary" title={t('tele.reopen')} onPress={() => void WebBrowser.openBrowserAsync(host.url, { dismissButtonStyle: 'close' })} />
          {host.encounterId ? <Button title={t('emr.openEncounter')} onPress={() => openEncounter(host.appointmentId, host.encounterId)} /> : <Muted>{t('video.noEncounter')}</Muted>}
        </Card>
      ) : null}

      {list.loading && !list.data ? <Loading /> : null}
      {list.data && !list.data.length ? <Empty text={t('video.none')} /> : null}
      {(list.data ?? []).map((v) => {
        const session = v.status ?? 'scheduled';
        const live = session === 'patient_waiting' || session === 'in_progress';
        const canStart = offset === 0 && STARTABLE.includes(v.appointment_status) && session !== 'ended' && session !== 'cancelled';
        return (
          <Card key={v.appointment_id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700', flex: 1 }}>{`${time(v.start_at, locale)} · ${v.patient_name}`}</T>
              <StatusBadge label={t(`tele.status.${session}`)} tone={session === 'patient_waiting' ? 'warn' : session === 'in_progress' ? 'success' : session === 'cancelled' ? 'danger' : 'info'} />
            </Row>
            <Row style={{ alignItems: 'center', marginTop: 4 }}>
              <Muted ltr>{v.ref}</Muted>
              <StatusBadge label={t(`status.${v.appointment_status}`)} tone={statusTone(v.appointment_status)} />
            </Row>
            {v.patient_joined_at ? <Muted>{`${t('video.patientJoined')} ${time(v.patient_joined_at, locale)}`}</Muted> : null}
            {v.appointment_status === 'requested' ? <Muted>{t('video.awaitingPayment')}</Muted> : null}
            {canStart ? <ActionButton title={session === 'in_progress' ? t('video.rejoin') : t('video.start')} onPress={() => start(v)} loading={act.busy} /> : null}
            {live ? <ActionButton kind="secondary" title={t('video.end')} onPress={() => end(v)} loading={act.busy} /> : null}
            {v.appointment_status === 'in_consultation' || v.appointment_status === 'completed' ? (
              <Button kind="ghost" title={t('emr.openEncounter')} onPress={() => openEncounter(v.appointment_id, null)} />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
