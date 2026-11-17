import { Redirect } from 'expo-router';

/** Deep link from the payment_received notification (`data.path` = `/invoices`). */
export default function InvoicesLink() {
  return <Redirect href="/patient/invoices" />;
}
