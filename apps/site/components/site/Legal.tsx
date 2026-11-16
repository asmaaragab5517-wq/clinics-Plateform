import { getT, tDyn, type Locale } from '@/lib/i18n';

/** Static legal page from catalogue sections `${prefix}.h{n}` / `${prefix}.p{n}`. */
export function LegalPage({ locale, prefix, title, updated }: { locale: Locale; prefix: 'privacy' | 'terms'; title: string; updated: string }) {
  const tt = getT(locale);
  const sections = [1, 2, 3, 4, 5, 6];
  return (
    <article className="container-page max-w-3xl py-8">
      <h1 className="mb-2 text-3xl font-bold">{title}</h1>
      <p className="mb-8 text-sm text-muted">{tt('legal.updated', { date: updated })}</p>
      <div className="space-y-6 leading-relaxed">
        {sections.map((n) => (
          <section key={n}>
            <h2 className="mb-2 text-xl font-bold">{tDyn(locale, `${prefix}.h${n}`)}</h2>
            <p>{tDyn(locale, `${prefix}.p${n}`)}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
