import type { Metadata } from 'next';
import { Alert, Badge, Card, Table } from '@hf/ui';
import { Section, Unavailable } from '@/components/site/bits';
import { publicList } from '@/lib/api';
import { money, nameOf } from '@/lib/format';
import { asLocale, getT, has, t, tDyn } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo';
import type { Clinic, PriceRow, PublicPackage } from '@/lib/types';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  return pageMetadata({ locale, path: '/services', title: t(locale, 'services.title'), description: t(locale, 'services.metaDescription') });
}

export default async function ServicesPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  const tt = getT(locale);
  const [rows, clinics, packages] = await Promise.all([publicList<PriceRow>('public/services'), publicList<Clinic>('public/clinics'), publicList<PublicPackage>('public/packages')]);
  const groups = new Map<string, PriceRow[]>();
  for (const r of rows ?? []) {
    const k = r.clinic_id ?? '';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const clinicName = (id: string) => (id ? nameOf(locale, clinics?.find((c) => c.id === id)) || tt('services.otherClinic') : tt('services.otherClinic'));

  return (
    <div className="container-page py-8">
      <h1 className="mb-2 text-2xl font-bold">{tt('services.title')}</h1>
      <div className="mb-6">
        <Alert tone="info">{tt('services.vatNote')}</Alert>
      </div>
      {rows === null ? (
        <Unavailable locale={locale} />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted">{tt('services.empty')}</p>
      ) : (
        [...groups.entries()].map(([clinicId, items]) => (
          <Section key={clinicId || 'none'} title={clinicName(clinicId)}>
            <Table>
              <thead>
                <tr>
                  <th scope="col">{tt('services.service')}</th>
                  <th scope="col">{tt('services.duration')}</th>
                  <th scope="col">{tt('services.vat')}</th>
                  <th scope="col">{tt('services.price')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={`${s.id}-${clinicId}`}>
                    <td>
                      <div className="font-medium">{nameOf(locale, s)}</div>
                      <div className="text-xs text-muted">{has(`serviceType.${s.type}`) ? tDyn(locale, `serviceType.${s.type}`) : s.type}</div>
                    </td>
                    <td className="num">{tt('services.minutes', { minutes: s.duration_minutes })}</td>
                    <td>{s.vat === 'taxable' ? <Badge tone="warning">{tt('services.taxable')}</Badge> : <Badge>{tt('services.exempt')}</Badge>}</td>
                    <td className="num font-bold">{money(s.price, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        ))
      )}
      {packages && packages.length > 0 && (
        <Section title={tt('services.packages')}>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((p) => (
              <li key={p.id}>
                <Card className="flex h-full flex-col gap-1">
                  <h3 className="font-bold">{nameOf(locale, p)}</h3>
                  <p className="text-sm text-muted">{tt('services.packageSessions', { count: p.sessions, days: p.validity_days })}</p>
                  <p className="num mt-auto text-lg font-bold">{money(p.price, locale)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
