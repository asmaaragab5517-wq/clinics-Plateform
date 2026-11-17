import { useEffect, useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Loading, Screen } from '../../components/ui';
import { claimPaymentReturn, paymentParams } from '../../lib/deepLinks';

/**
 * HealthPay return (FR-APP-5). App bookings (`x-client: app`) come back to `healthflow://book/result?ref=…&appointment=…`
 * (payments.ts APP_RETURN_URL); a Universal/App Link to https://<site>/book/result?ref=… lands here too.
 * When the checkout auth session already handled this return (lib/payments.ts), this screen just closes itself.
 */
export default function BookResultLink() {
  const { ref, appointment } = useLocalSearchParams<{ ref?: string; appointment?: string }>();
  const params = paymentParams(ref, appointment);
  const [mine] = useState(() => claimPaymentReturn(params.ref));
  useEffect(() => {
    if (!mine && router.canGoBack()) router.back();
  }, [mine]);
  if (!mine && router.canGoBack()) return <Screen scroll={false}><Loading /></Screen>;
  return <Redirect href={{ pathname: '/patient/payment-result', params }} />;
}
