'use client';

import { useEffect, useState } from 'react';
import { cx } from '@hf/ui';
import { useApi, useInterval } from '@/lib/hooks';
import { biName } from '@/lib/format';
import { useI18n } from './i18n';

interface Announcement {
  id: string;
  title_ar: string;
  title_en: string;
  body_ar: string;
  body_en: string;
  severity: 'info' | 'warning' | 'maintenance';
  starts_at: string;
  ends_at: string;
}

const KEY = 'hf_ann_dismissed';

/** Platform announcements (maintenance windows, notices) shown to every staff user while active; dismissible per browser. */
export function AnnouncementsBanner() {
  const { t, locale } = useI18n();
  const q = useApi<Announcement[]>('/announcements');
  const [dismissed, setDismissed] = useState<string[]>([]);
  useInterval(() => q.reload(), 10 * 60_000);
  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
    } catch {
      /* ignore */
    }
  }, []);
  const visible = (q.data ?? []).filter((a) => !dismissed.includes(a.id));
  if (!visible.length) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-2" role="region" aria-label={t('ann.region')}>
      {visible.map((a) => (
        <div
          key={a.id}
          role={a.severity === 'info' ? 'status' : 'alert'}
          className={cx(
            'flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm',
            a.severity === 'info' && 'bg-accent/10 text-accent',
            a.severity === 'warning' && 'bg-warning/10 text-warning',
            a.severity === 'maintenance' && 'bg-danger/10 text-danger',
          )}
        >
          <div>
            <strong>{biName({ name_ar: a.title_ar, name_en: a.title_en }, locale)}</strong>
            <span className="ms-2">{biName({ name_ar: a.body_ar, name_en: a.body_en }, locale)}</span>
          </div>
          <button type="button" className="shrink-0 text-xs underline" onClick={() => dismiss(a.id)}>
            {t('common.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
