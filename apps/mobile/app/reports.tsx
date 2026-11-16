import { Redirect } from 'expo-router';

/** Deep link from the report_ready message. */
export default function ReportsLink() {
  return <Redirect href="/patient/documents" />;
}
