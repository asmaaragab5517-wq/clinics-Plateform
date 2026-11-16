import { serverConfig } from '@/lib/server/config';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

const SEEDED = ['owner', 'director', 'manager', 'reception', 'reception2', 'nurse', 'accountant', 'ahmed-samy', 'mona-khaled', 'sara-adel'];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const slug = serverConfig.orgSlug;
  return <LoginForm mode={serverConfig.authMode} users={SEEDED.map((u) => `${u}@${slug}.healthflow.eg`)} next={sp.next ?? '/'} error={sp.error ?? null} />;
}
