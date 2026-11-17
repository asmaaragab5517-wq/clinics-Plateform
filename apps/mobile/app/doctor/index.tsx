import { useEffect } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { ActionButton, Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Section, StatusBadge, T } from '../../components/ui';
import { statusTone } from '../../components/AppointmentCard';
import { isApiError } from '../../lib/api';
import { staffApi } from '../../lib/endpoints';
import { time } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { todayRange } from '../../lib/today';
import { useAction, useQuery } from '../../lib/useQuery';
import type { QueueTicket } from '../../lib/types';

/** Doctor mode (FR-APP-2): today's queue in the selected clinic, call next, start consultation. */
export default function DoctorToday() {
  const { t, locale, pick } = useI18n();
  const { staff, clinicId, clinics } = useSession();
  const me = staff!.userId;
  const queue = useQuery(`dq:${clinicId}:${me}`, () => staffApi.queue(clinicId!, me));
  const range = todayRange();
  const appts = useQuery(`da:${clinicId}:${range.date}`, () => staffApi.appointments({ clinicId: clinicId!, doctorId: me, from: range.from, to: range.to }));
  const act = useAction();

  // Poll the queue (the SSE stream is not consumed on mobile; see README).
  useEffect(() => {
    const id = setInterval(() => void queue.reload(), 20000);
    return () => clearInterval(id);
  }, [queue.reload]);

  const g = queue.data?.[0];
  const current = g?.serving ?? g?.called ?? null;

  const callNext = () =>
    void act.run(async () => {
      try {
        await staffApi.callNext(clinicId!, me);
      } catch (e) {
        if (isApiError(e, 'queue_empty')) Alert.alert(t('queue.empty'));
        else throw e;
      }
      await queue.reload();
    });

  const start = (tk: QueueTicket) =>
    void act.run(async () => {
      if (tk.status !== 'serving') await staffApi.transition(tk.appointment_id, 'in_consultation');
      await queue.reload();
      router.push({ pathname: '/doctor/encounter/[appointmentId]', params: { appointmentId: tk.appointment_id, patientId: tk.patient_id, encounterId: tk.encounter_id ?? undefined } });
    });

  return (
    <Screen refreshing={queue.loading} onRefresh={() => { void queue.reload(); void appts.reload(); }}>
      <Muted>{pick(clinics.find((c) => c.id === clinicId))}</Muted>
      <ErrorBox error={act.error ?? queue.error} />
      <Section title={t('queue.nowServing')}>
        {queue.loading && !queue.data ? <Loading /> : null}
        {current ? (
          <Card>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T style={{ fontSize: 22, fontWeight: '700' }}>{`${t('queue.ticket')} ${current.ticket_number}`}</T>
              <StatusBadge label={t(`queue.status.${current.status}`)} />
            </Row>
            <T>{current.patient_name ?? ''}</T>
            <ActionButton title={current.status === 'serving' ? t('emr.openEncounter') : t('emr.startConsultation')} onPress={() => start(current)} loading={act.busy} />
          </Card>
        ) : (
          <Empty text={t('queue.noneServing')} />
        )}
        <ActionButton title={t('queue.callNext')} onPress={callNext} loading={act.busy} disabled={!g?.waiting.length} />
      </Section>

      <Section title={`${t('queue.waiting')} (${g?.waiting.length ?? 0})`}>
        {(g?.waiting ?? []).map((w) => (
          <Card key={w.id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700' }}>{`${w.ticket_number} · ${w.patient_name ?? ''}`}</T>
              {w.priority !== 'normal' ? <StatusBadge label={t(`queue.priority.${w.priority}`)} tone={w.priority === 'emergency' ? 'danger' : 'warn'} /> : null}
            </Row>
            <Muted>{`${t('queue.checkedInAt')} ${time(w.checked_in_at, locale)}`}</Muted>
          </Card>
        ))}
        {g && !g.waiting.length ? <Empty /> : null}
      </Section>

      <Section title={t('doctor.todayAppointments')}>
        <ErrorBox error={appts.error} />
        {(appts.data ?? []).map((a) => (
          <Card key={a.id}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '600', flex: 1 }}>{`${time(a.start_at, locale)} · ${a.patient_name}`}</T>
              <StatusBadge label={t(`status.${a.status}`)} tone={statusTone(a.status)} />
            </Row>
            <Muted>{a.services.map((x) => pick(x)).join(', ')}</Muted>
            {a.encounter_id && (a.status === 'in_consultation' || a.status === 'completed') ? (
              <Button kind="ghost" title={t('emr.openEncounter')} onPress={() => router.push({ pathname: '/doctor/encounter/[appointmentId]', params: { appointmentId: a.id, patientId: a.patient_id, encounterId: a.encounter_id ?? undefined } })} />
            ) : null}
          </Card>
        ))}
        {appts.data && !appts.data.length ? <Empty /> : null}
      </Section>
      <Button kind="secondary" title={t('video.title')} onPress={() => router.push('/doctor/video')} />
      <Button kind="secondary" title={t('doctor.earnings')} onPress={() => router.push('/doctor/earnings')} />
    </Screen>
  );
}
