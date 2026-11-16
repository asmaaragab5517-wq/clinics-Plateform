import { useState } from 'react';
import { CheckInResult } from '../../components/CheckInResult';
import { PatientPicker } from '../../components/PatientPicker';
import { ActionButton, Button, Card, Empty, ErrorBox, H2, Loading, Muted, Screen, T } from '../../components/ui';
import { staffApi } from '../../lib/endpoints';
import { patientName, time } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { todayRange } from '../../lib/today';
import { useAction, useQuery } from '../../lib/useQuery';
import type { PatientSearchRow } from '../../lib/types';

/** Check-in by search (FR-APP-3): find the patient, then check in today's booking at this clinic. */
export default function SearchCheckIn() {
  const { t, locale } = useI18n();
  const { clinicId } = useSession();
  const [p, setP] = useState<PatientSearchRow | null>(null);
  const [ticket, setTicket] = useState<number | null | undefined>(undefined);
  const r = todayRange();
  const appts = useQuery(p ? `pa:${p.id}:${clinicId}` : null, () => staffApi.appointments({ clinicId: clinicId!, patientId: p!.id, from: r.from, to: r.to }));
  const act = useAction();

  if (!p) return <Screen><PatientPicker onPick={setP} /></Screen>;
  return (
    <Screen>
      <H2>{patientName(p, locale)}</H2>
      <Muted ltr>{p.mrn}</Muted>
      {ticket !== undefined ? <CheckInResult ticket={ticket} /> : null}
      {appts.loading ? <Loading /> : null}
      <ErrorBox error={appts.error ?? act.error} />
      {appts.data && !appts.data.length ? <Empty text={t('reception.noBookingToday')} /> : null}
      {(appts.data ?? []).map((a) => (
        <Card key={a.id}>
          <T style={{ fontWeight: '600' }}>{`${time(a.start_at, locale)} · ${a.doctor_name}`}</T>
          <Muted>{t(`status.${a.status}`)}</Muted>
          {a.status === 'booked' || a.status === 'confirmed' ? (
            <ActionButton title={t('reception.checkIn')} loading={act.busy} onPress={() => void act.run(async () => { const res = await staffApi.checkIn(a.id); setTicket(res.ticket?.ticket_number ?? null); await appts.reload(); })} />
          ) : null}
        </Card>
      ))}
      <Button kind="ghost" title={t('reception.otherPatient')} onPress={() => { setP(null); setTicket(undefined); }} />
    </Screen>
  );
}
