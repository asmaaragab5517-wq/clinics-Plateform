import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { QueuePriority } from '@hf/shared';
import { CheckInResult } from '../../components/CheckInResult';
import { PatientPicker } from '../../components/PatientPicker';
import { ActionButton, Banner, Button, Chip, Empty, ErrorBox, H2, Loading, Muted, Screen, Section, s } from '../../components/ui';
import { newIdempotencyKey, staffApi } from '../../lib/endpoints';
import { patientName } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useAction, useQuery } from '../../lib/useQuery';
import type { PatientSearchRow } from '../../lib/types';

const PRIORITIES: QueuePriority[] = ['normal', 'elderly', 'emergency'];

/**
 * Quick walk-in (FR-APP-3 "quick booking"): patient → doctor → service → priority → POST /v1/appointments/walk-in,
 * which books and checks in at once. Doctors come from the staff directory (GET /v1/doctors?clinicId=, so
 * non-public doctors are included) and services from GET /v1/services filtered by the doctor's service_ids.
 * One Idempotency-Key per attempt, reused when the same submission is retried, so a timeout cannot issue two tickets.
 */
export default function WalkIn() {
  const { t, locale, pick } = useI18n();
  const { clinicId } = useSession();
  const [p, setP] = useState<PatientSearchRow | null>(null);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [priority, setPriority] = useState<QueuePriority>('normal');
  const [ticket, setTicket] = useState<number | null | undefined>(undefined);
  const [replayed, setReplayed] = useState(false);
  const doctors = useQuery(`wd:${clinicId}`, () => staffApi.doctors(clinicId!));
  const services = useQuery('staff:services', staffApi.services);
  const act = useAction();
  // Key for the current submission; cleared whenever the selection changes or a walk-in succeeds.
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  const doctor = doctors.data?.find((d) => d.id === doctorId) ?? null;
  const doctorServices = useMemo(() => {
    if (!doctor) return [];
    const ids = new Set(doctor.service_ids);
    // Video consultations need online payment and a meeting, so they are not offered as walk-ins.
    return (services.data ?? []).filter((sv) => ids.has(sv.id) && sv.is_active && sv.type !== 'telemedicine');
  }, [doctor, services.data]);

  const reset = () => {
    setP(null);
    setDoctorId(null);
    setServiceId(null);
    setPriority('normal');
    setTicket(undefined);
    setReplayed(false);
    attempt.current = null;
  };

  if (ticket !== undefined)
    return (
      <Screen>
        {replayed ? <Banner kind="info">{t('reception.walkInReplayed')}</Banner> : null}
        <CheckInResult ticket={ticket} />
        <Button title={t('reception.walkInNext')} onPress={reset} />
      </Screen>
    );
  if (!p) return <Screen><PatientPicker onPick={setP} /></Screen>;

  const submit = () =>
    void act.run(async () => {
      const body = { patientId: p.id, clinicId: clinicId!, doctorId: doctorId!, serviceIds: [serviceId!], priority };
      const sig = JSON.stringify(body);
      if (attempt.current?.sig !== sig) attempt.current = { sig, key: newIdempotencyKey() };
      const r = await staffApi.walkIn(body, attempt.current.key);
      attempt.current = null;
      setReplayed(!!r.replayed);
      setTicket(r.ticket?.ticket_number ?? null);
    });

  return (
    <Screen>
      <H2>{patientName(p, locale)}</H2>
      <Muted ltr>{p.mrn}</Muted>
      <Section title={t('booking.step.doctor')}>
        {doctors.loading && !doctors.data ? <Loading /> : null}
        <ErrorBox error={doctors.error} onRetry={() => void doctors.reload()} />
        {doctors.data && !doctors.data.length ? <Empty /> : null}
        <View style={s.wrap}>
          {(doctors.data ?? []).map((d) => (
            <Chip key={d.id} label={[d.title, pick(d)].filter(Boolean).join(' ')} selected={doctorId === d.id} onPress={() => { setDoctorId(d.id); setServiceId(null); }} />
          ))}
        </View>
      </Section>
      {doctor ? (
        <Section title={t('booking.step.service')}>
          {services.loading && !services.data ? <Loading /> : null}
          <ErrorBox error={services.error} onRetry={() => void services.reload()} />
          {services.data && !doctorServices.length ? <Empty /> : null}
          <View style={s.wrap}>
            {doctorServices.map((sv) => (
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
      <ActionButton title={t('reception.walkInSubmit')} disabled={!doctor || !serviceId} loading={act.busy} onPress={submit} />
      <Button kind="ghost" title={t('reception.otherPatient')} onPress={() => { setP(null); attempt.current = null; }} />
    </Screen>
  );
}
