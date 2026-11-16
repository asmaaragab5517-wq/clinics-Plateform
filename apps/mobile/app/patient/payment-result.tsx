import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Banner, Button, Loading, Muted, Screen } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { useI18n } from '../../lib/i18n';
import type { PortalAppointment } from '../../lib/types';

/**
 * Payment result (FR-APP-5 deep link /book/result?ref=…, or after closing the checkout browser).
 * The HealthPay webhook is the source of truth (FR-HP-3), so poll the appointment status for up to ~30 s.
 */
export default function PaymentResult() {
  const { ref, id } = useLocalSearchParams<{ ref?: string; id?: string }>();
  const { t } = useI18n();
  const [a, setA] = useState<PortalAppointment | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const list = await portalApi.appointments('upcoming');
        const hit = list.find((x) => (id && x.id === id) || (ref && x.ref === ref)) ?? null;
        if (!stop) setA(hit);
        if (hit && hit.status !== 'requested') return;
      } catch {
        /* offline: keep polling */
      }
      if (!stop) setTries((n) => n + 1);
    };
    const h = setTimeout(() => void tick(), tries === 0 ? 0 : 3000);
    return () => {
      stop = true;
      clearTimeout(h);
    };
  }, [tries, id, ref]);

  const paid = a && a.status !== 'requested';
  const waiting = !paid && tries < 10;
  return (
    <Screen>
      {waiting ? <Loading /> : null}
      {waiting ? <Muted style={{ textAlign: 'center' }}>{t('payment.checking')}</Muted> : null}
      {paid ? <Banner kind="success">{t('payment.success')}</Banner> : null}
      {!paid && !waiting ? <Banner kind="warn">{t('payment.notConfirmed')}</Banner> : null}
      {a ? <Button title={t('patient.appointment')} onPress={() => router.replace({ pathname: '/patient/appointments/[id]', params: { id: a.id } })} /> : null}
      <Button kind="secondary" title={t('nav.home')} onPress={() => router.replace('/patient')} />
    </Screen>
  );
}
