import { Redirect } from 'expo-router';

/** Deep link from the prescription_shared message (app-side; the SMS itself links to the API share URL). */
export default function RxLink() {
  return <Redirect href="/patient/prescriptions" />;
}
