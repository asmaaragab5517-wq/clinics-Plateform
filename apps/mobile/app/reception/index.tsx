import { useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { ActionButton, Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Section, StatusBadge, T, colors, s } from '../../components/ui';
import { staffApi } from '../../lib/endpoints';
import { time } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { todayRange } from '../../lib/today';
import { useAction, useQuery } from '../../lib/useQuery';
import type { QueueGroup } from '../../lib/types';

/** Reception mode (FR-APP-3, tablet-first): live queue per doctor, today's arrivals, check-in, walk-in. */
export default function Reception() {
  const { t, locale, pick } = useI18n();
  const { clinicId, clinics } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const queue = useQuery(`rq:${clinicId}`, () => staffApi.queue(clinicId!));
  const range = todayRange();
  const appts = useQuery(`ra:${clinicId}:${range.date}`, () => staffApi.appointments({ clinicId: clinicId!, from: range.from, to: range.to, status: 'requested,booked,confirmed' }));
  const act = useAction();

  useEffect(() => {
    const id = setInterval(() => void queue.reload(), 15000);
    return () => clearInterval(id);
  }, [queue.reload]);

  const refresh = async () => {
    await Promise.all([queue.reload(), appts.reload()]);
  };

  const checkIn = (id: string) =>
    void act.run(async () => {
      await staffApi.checkIn(id);
      await refresh();
    });

  const QueueCol = ({ g }: { g: QueueGroup }) => (
    <Card>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700', flex: 1 }}>{g.doctorName}</T>
        <T>{`${t('queue.nowServing')}: ${g.serving?.ticket_number ?? g.called?.ticket_number ?? '—'}`}</T>
      </Row>
      <Muted>{`${t('queue.waiting')}: ${g.waiting.length} · ${t('queue.done')}: ${g.done}`}</Muted>
      {g.waiting.map((w) => (
        <Row key={w.id} style={{ alignItems: 'center', flexWrap: 'wrap', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
          <T style={{ flex: 1 }}>{`${w.ticket_number} · ${w.patient_name ?? ''}`}</T>
          {w.priority !== 'normal' ? <StatusBadge label={t(`queue.priority.${w.priority}`)} tone={w.priority === 'emergency' ? 'danger' : 'warn'} /> : null}
          <Button kind="ghost" title={t('queue.priority.emergency')} onPress={() => void act.run(async () => { await staffApi.updateTicket(w.id, { priority: 'emergency' }); await queue.reload(); })} style={{ marginBottom: 0 }} />
          <Button kind="ghost" title={t('queue.priority.elderly')} onPress={() => void act.run(async () => { await staffApi.updateTicket(w.id, { priority: 'elderly' }); await queue.reload(); })} style={{ marginBottom: 0 }} />
          <Button kind="ghost" title={t('queue.skip')} onPress={() => void act.run(async () => { await staffApi.updateTicket(w.id, { status: 'skipped' }); await queue.reload(); })} style={{ marginBottom: 0 }} />
        </Row>
      ))}
    </Card>
  );

  return (
    <Screen refreshing={queue.loading} onRefresh={() => void refresh()}>
      <Muted>{pick(clinics.find((c) => c.id === clinicId))}</Muted>
      <Row style={{ gap: 8, flexWrap: 'wrap', marginVertical: 8 }}>
        <Button title={t('reception.scan')} onPress={() => router.push('/reception/scan')} style={{ flexGrow: 1 }} />
        <Button kind="secondary" title={t('reception.searchCheckIn')} onPress={() => router.push('/reception/search')} style={{ flexGrow: 1 }} />
        <Button kind="secondary" title={t('reception.walkIn')} onPress={() => router.push('/reception/walk-in')} style={{ flexGrow: 1 }} />
      </Row>
      <ErrorBox error={act.error ?? queue.error} />
      <View style={wide ? [s.row, { gap: 16, alignItems: 'flex-start' }] : undefined}>
        <View style={wide ? { flex: 3 } : undefined}>
          <Section title={t('reception.queue')}>
            {queue.loading && !queue.data ? <Loading /> : null}
            {queue.data && !queue.data.length ? <Empty /> : null}
            {(queue.data ?? []).map((g) => (
              <QueueCol key={g.doctorId} g={g} />
            ))}
          </Section>
        </View>
        <View style={wide ? { flex: 2 } : undefined}>
          <Section title={t('reception.arrivals')}>
            <ErrorBox error={appts.error} />
            {appts.data && !appts.data.length ? <Empty /> : null}
            {(appts.data ?? []).map((a) => (
              <Card key={a.id}>
                <T style={{ fontWeight: '600' }}>{`${time(a.start_at, locale)} · ${a.patient_name}`}</T>
                <Muted>{`${a.doctor_name} · ${t(`status.${a.status}`)}`}</Muted>
                <ActionButton title={t('reception.checkIn')} onPress={() => checkIn(a.id)} loading={act.busy} disabled={a.status === 'requested'} />
              </Card>
            ))}
          </Section>
        </View>
      </View>
    </Screen>
  );
}
