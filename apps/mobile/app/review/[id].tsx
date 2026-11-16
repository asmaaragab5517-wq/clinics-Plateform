import { Redirect, useLocalSearchParams } from 'expo-router';

/** Deep link from the review_request message (link `review/<appointmentId>`). */
export default function ReviewLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/patient/review/[id]', params: { id } }} />;
}
