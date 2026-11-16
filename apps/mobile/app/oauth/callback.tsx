import { Redirect } from 'expo-router';

/** OIDC redirect target (healthflow://oauth/callback). The auth session consumes the URL; just go home. */
export default function OAuthCallback() {
  return <Redirect href="/" />;
}
