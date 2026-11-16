import Link from 'next/link';
import { Alert, Badge, Bdi, Card } from '@hf/ui';
import { doctorTitle, governorateName, money, nameOf, num } from '@/lib/format';
import { getT, t, type Locale } from '@/lib/i18n';
import type { Clinic, Doctor } from '@/lib/types';

export function Unavailable({ locale }: { locale: Locale }) {
  return <Alert tone="warning">{t(locale, 'site.unavailable')}</Alert>;
}

export function Section({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <section className="mt-10" aria-labelledby={hid}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={hid} className="text-xl font-bold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Star rating with an accessible text equivalent. */
export function Stars({ value, count, locale }: { value: number | null; count?: number | null; locale: Locale }) {
  if (value === null || !count) return <span className="text-sm text-muted">{t(locale, 'doctor.notRated')}</span>;
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span aria-hidden className="text-warning">
        {'★'.repeat(rounded)}
        <span className="text-border">{'★'.repeat(5 - rounded)}</span>
      </span>
      <span className="sr-only">{t(locale, 'doctor.ratingOf', { value: value.toFixed(1) })}</span>
      <span className="num" aria-hidden>
        {value.toFixed(1)}
      </span>
      <span className="text-muted">({t(locale, 'doctor.reviewsCount', { count })})</span>
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name.replace(/^(\u062F\.|Dr\.?)\s*/u, '').trim().slice(0, 1);
  return (
    <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-xl font-bold text-primary">
      {initials}
    </span>
  );
}

export function DoctorCard({ doctor, locale }: { doctor: Doctor; locale: Locale }) {
  const tt = getT(locale);
  const name = nameOf(locale, doctor);
  const fee = num(doctor.fee);
  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start gap-3">
        <Avatar name={name} />
        <div className="min-w-0">
          <h3 className="font-bold">
            <Link href={`/${locale}/doctors/${doctor.slug}`} className="hover:text-primary">
              <Bdi>{name}</Bdi>
            </Link>
          </h3>
          <p className="text-sm text-muted">
            {[doctorTitle(locale, doctor.title), ...doctor.specialties.map((s) => nameOf(locale, s))].filter(Boolean).join(' · ')}
          </p>
          <Stars value={num(doctor.rating_avg)} count={doctor.rating_count} locale={locale} />
        </div>
      </div>
      {doctor.clinics.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {doctor.clinics.map((c) => (
            <li key={c.id}>
              <Badge>{nameOf(locale, c)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-sm">
          {fee !== null ? (
            <>
              <span className="text-muted">{tt('doctor.fee')}: </span>
              <span className="num font-bold">{money(fee, locale)}</span>
            </>
          ) : null}
        </span>
        <Link href={`/${locale}/book?doctor=${encodeURIComponent(doctor.slug)}`} className="btn-primary btn-sm">
          {tt('doctor.book')}
        </Link>
      </div>
    </Card>
  );
}

export function ClinicCard({ clinic, locale }: { clinic: Clinic; locale: Locale }) {
  const tt = getT(locale);
  return (
    <Card className="flex h-full flex-col gap-2">
      <h3 className="font-bold">
        <Link href={`/${locale}/clinics/${clinic.slug}`} className="hover:text-primary">
          {nameOf(locale, clinic)}
        </Link>
      </h3>
      <p className="text-sm text-muted">
        {governorateName(locale, clinic.governorate)}
        {clinic.city ? ` · ${clinic.city}` : ''}
      </p>
      {clinic.address_lines && (
        <p className="text-sm" dir="auto">
          {clinic.address_lines}
        </p>
      )}
      {!!clinic.phones?.length && (
        <p className="text-sm">
          <span className="text-muted">{tt('clinics.phones')}: </span>
          {clinic.phones.map((p, i) => (
            <span key={p}>
              {i > 0 && ', '}
              <a href={`tel:${p}`} className="link">
                <Bdi>{p}</Bdi>
              </a>
            </span>
          ))}
        </p>
      )}
      {!!clinic.specialties?.length && (
        <ul className="mt-auto flex flex-wrap gap-1 pt-2">
          {clinic.specialties.map((s) => (
            <li key={s.slug}>
              <Badge tone="primary">{nameOf(locale, s)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Breadcrumbs({ items, locale }: { items: { href?: string; label: string }[]; locale: Locale }) {
  return (
    <nav aria-label={t(locale, 'site.breadcrumb')} className="mb-4 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center gap-1">
            {idx > 0 && <span aria-hidden>/</span>}
            {i.href ? (
              <Link href={i.href} className="hover:text-primary">
                {i.label}
              </Link>
            ) : (
              <span aria-current="page">{i.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
