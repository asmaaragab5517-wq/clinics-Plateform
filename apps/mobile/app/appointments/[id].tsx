import { Redirect, useLocalSearchParams } from 'expo-router';

/** Deep link to a booking (SMS/WhatsApp confirmation and reminders). */
export default function AppointmentLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/patient/appointments/[id]', params: { id } }} />;
}
