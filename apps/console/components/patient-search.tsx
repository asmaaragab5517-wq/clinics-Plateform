'use client';

import { forwardRef, useEffect, useState } from 'react';
import { Bdi, Input, cx } from '@hf/ui';
import { qs } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { isoDate, patientName } from '@/lib/format';
import type { PatientRow } from '@/lib/types';
import { ErrorAlert, Loading } from './common';
import { useI18n } from './i18n';

/** Search by phone, National ID, MRN or name (FR-PAT, LOC-8: the API normalises Arabic). */
export const PatientSearch = forwardRef<HTMLInputElement, { onSelect: (p: PatientRow) => void; selectedId?: string | null; id?: string; compact?: boolean }>(function PatientSearch({ onSelect, selectedId, id = 'patient-search', compact }, ref) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const { data, loading, error } = useApi<PatientRow[]>(term.length >= 2 ? `/patients${qs({ q: term })}` : null);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [data]);
  const results = term.length >= 2 ? (data ?? []) : [];
  const listId = `${id}-results`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t('pat.search')}
      </label>
      <Input
        ref={ref}
        id={id}
        type="search"
        value={q}
        autoComplete="off"
        placeholder={t('pat.searchHint')}
        onChange={(e) => setQ(e.target.value)}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            onSelect(results[active]);
          }
        }}
      />
      {loading && term.length >= 2 && <Loading className="p-1" />}
      <ErrorAlert error={error} />
      {term.length >= 2 && !loading && !error && results.length === 0 && <p className="text-sm text-muted">{t('pat.noResults')}</p>}
      {results.length > 0 && (
        <ul id={listId} role="listbox" className={cx('overflow-y-auto rounded-xl border border-border', compact ? 'max-h-48' : 'max-h-72')}>
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={p.id === selectedId || i === active}
              className={cx('flex cursor-pointer flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0', i === active && 'bg-bg', p.id === selectedId && 'bg-primary/10')}
              onMouseEnter={() => setActive(i)}
              onClick={() => onSelect(p)}
            >
              <span className="font-medium">
                <Bdi>{patientName(p, locale)}</Bdi>
              </span>
              <span className="flex gap-3 text-xs text-muted">
                <Bdi className="num">{p.mrn}</Bdi>
                {p.phone && <Bdi className="num">{p.phone}</Bdi>}
                <span className="num">{isoDate(p.date_of_birth)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
