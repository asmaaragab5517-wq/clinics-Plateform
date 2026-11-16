import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PortalProvider } from '@/components/portal/PortalShell';
import { asLocale } from '@/lib/i18n';
import { REFRESH_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  if (!(await cookies()).get(REFRESH_COOKIE)?.value) redirect(`/${locale}/portal/sign-in`);
  return <PortalProvider locale={locale}>{children}</PortalProvider>;
}
