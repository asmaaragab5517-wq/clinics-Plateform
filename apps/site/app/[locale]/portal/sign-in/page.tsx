import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignIn } from '@/components/portal/SignIn';
import { asLocale } from '@/lib/i18n';
import { REFRESH_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  const next = (await searchParams).next;
  if ((await cookies()).get(REFRESH_COOKIE)?.value && !next) redirect(`/${locale}/portal`);
  return <SignIn locale={locale} next={typeof next === 'string' ? next : undefined} />;
}
