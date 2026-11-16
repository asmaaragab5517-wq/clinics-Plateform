import { useState } from 'react';
import { View } from 'react-native';
import type { QueuePriority } from '@hf/shared';
import { CheckInResult } from '../../components/CheckInResult';
import { PatientPicker } from '../../components/PatientPicker';
import { ActionButton, Button, Chip, ErrorBox, H2, Loading, Muted, Screen, Section, s } from '../../components/ui';
import { publicApi, staffApi } from '../../lib/endpoints';
import { patientName } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useAction, useQuery } from '../../lib/useQuery';
import type { PatientSearchRow } from '../../lib/types';

const PRIORITIES: QueuePriority[] = ['normal', 'elderly', 'emergency'];

/**
 * Quick walk-in (FR-APP-3 "quick booking"): patient → doctor → service → priority → POST /v1/appointments/walk-in,
 * which books and checks in at once. Doctors come from the public directory filtered by clinic because
 * receptionists lack staff:view for GET /v1/doctors (README "API gaps").
 */
export default function WalkIn() {
  const { t, locale, pick } = useI18n();
  const { clinicId } = useSession();
  const [p, setP] = useState<PatientSearchRow | null>(null);
  const [doctorSlug, setDoctorSlug] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [priority, setPriority] = useState<QueuePriority>('normal');
  const [ticket, setTicket] = useState<number | null | undefined>(undefined);
  const doctors = useQuery(`wd:${clinicId}`, () => publicApi.doctors({ clinicId: clinicId! }));
  const doctor = useQuery(doctorSlug ? `doctor:${doctorSlug}` : null, () => publicApi.doctor(doctorSlug!));
  const act = useAction();

  const reset = () => {
    setP(null);
    setDoctorSlug(null);
    setServiceId(null);
    setPriority('normal');
    setTicket(undefined);
  };

  if (ticket !== undefined)
    return (
      <Screen>
        <CheckInResult ticket={ticket} />
        <Button title={t('reception.walkInNext')} onPress={reset} />
      </Screen>
    );
  if (!p) return <Screen><PatientPicker onPick={setP} /></Screen>;

  return (
    <Screen>
      <H2>{patientName(p, locale)}</H2>
      <Muted ltr>{p.mrn}</Muted>
      <Section title={t('booking.step.doctor')}>
        {doctors.loading ? <Loading /> : null}
        <ErrorBox error={doctors.error} />
        <View style={s.wrap}>
          {(doctors.data ?? []).map((d) => (
            <Chip key={d.id} label={pick(d)} selected={doctorSlug === d.slug} onPress={() => { setDoctorSlug(d.slug); setServiceId(null); }} />
          ))}
        </View>
      </Section>
      {doctorSlug ? (
        <Section title={t('booking.step.service')}>
          {doctor.loading ? <Loading /> : null}
          <View style={s.wrap}>
            {(doctor.data?.services ?? []).map((sv) => (
              <Chip key={sv.id} label={pick(sv)} selected={serviceId === sv.id} onPress={() => setServiceId(sv.id)} />
            ))}
          </View>
        </Section>
      ) : null}
      <Section title={t('queue.priorityTitle')}>
        <View style={s.wrap}>
          {PRIORITIES.map((pr) => (
            <Chip key={pr} label={t(`queue.priority.${pr}`)} selected={priority === pr} onPress={() => setPriority(pr)} />
          ))}
        </View>
      </Section>
      <ErrorBox error={act.error} />
      <ActionButton
        title={t('reception.walkInSubmit')}
        disabled={!doctor.data || !serviceId}
        loading={act.busy}
        onPress={() =>
          void act.run(async () => {
            const r = await staffApi.walkIn({ patientId: p.id, clinicId: clinicId!, doctorId: doctor.data!.id, serviceIds: [serviceId!], priority });
            setTicket(r.ticket?.ticket_number ?? null);
          })
        }
      />
      <Button kind="ghost" title={t('reception.otherPatient')} onPress={() => setP(null)} />
    </Screen>
  );
}
