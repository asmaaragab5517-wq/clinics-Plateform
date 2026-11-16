import { headers } from 'next/headers';

/** schema.org structured data (FR-WEB-4). Carries the CSP nonce; `<` is escaped so content cannot break out. */
export async function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
