import { Redirect, useLocalSearchParams } from 'expo-router';

/** Universal/App Link: HealthPay returns to https://<site>/book/result?ref=… (payments.ts returnUrl). */
export default function BookResultLink() {
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  return <Redirect href={{ pathname: '/patient/payment-result', params: ref ? { ref } : {} }} />;
}
