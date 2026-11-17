'use client';

import { useState } from 'react';
import { Bdi, Input } from '@hf/ui';
import { qs } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { useI18n } from './i18n';

/** ICD-10 lookup (FR-EMR-3); calls `onAdd` with the code and its localised title. */
export function IcdSearch({ onAdd }: { onAdd: (code: string, title: string) => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const r = useApi<{ code: string; title_en: string; title_ar: string | null }[]>(term.length >= 2 ? `/icd10${qs({ q: term })}` : null);
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('enc.icdSearch')} aria-label={t('enc.icdSearch')} dir="auto" />
      {term.length >= 2 && (r.data?.length ?? 0) > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg" role="listbox">
          {r.data!.map((c) => (
            <li key={c.code} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-bg"
                onClick={() => {
                  onAdd(c.code, (locale === 'ar' ? c.title_ar : c.title_en) ?? c.title_en);
                  setQ('');
                }}
              >
                <Bdi className="num font-medium">{c.code}</Bdi> <span>{(locale === 'ar' ? c.title_ar : null) ?? c.title_en}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
