import { serverConfig } from '@/lib/server/config';
import { PlatformLoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return <PlatformLoginForm mode={serverConfig.authMode} defaultEmail={`platform@${serverConfig.orgSlug}.healthflow.eg`} next={sp.next ?? '/platform'} error={sp.error ?? null} />;
}
