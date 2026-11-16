import { Redirect } from 'expo-router';
import { Loading, Screen } from '../components/ui';
import { useSession } from '../lib/session';

/** Entry: route to sign-in, the mode switcher or the active mode's home. */
export default function Index() {
  const { ready, hasPatient, staffSignedIn, mode } = useSession();
  if (!ready)
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  if (!hasPatient && !staffSignedIn) return <Redirect href="/sign-in" />;
  if (!mode) return <Redirect href="/mode" />;
  return <Redirect href={`/${mode}`} />;
}
