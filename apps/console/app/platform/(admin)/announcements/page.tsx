'use client';

import { useState } from 'react';
import { Alert, Button, PageHeader } from '@hf/ui';
import { Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { pPost } from '@/lib/api';

function localInput(d: Date): string {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}

/** Announcements shown as a banner to every staff user of every organisation while active. */
export default function PlatformAnnouncementsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const blank = () => ({ titleAr: '', titleEn: '', bodyAr: '', bodyEn: '', severity: 'info', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 24 * 3600_000)) });
  const [f, setF] = useState(blank);
  const [sent, setSent] = useState<{ id: string; title: string }[]>([]);
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('plat.nav.announcements')} />
      <Section title={t('plat.ann.new')} className="max-w-3xl">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const starts = new Date(f.startsAt);
            const ends = new Date(f.endsAt);
            if (!(ends > starts)) return a.setError(t('plat.ann.endAfterStart'));
            const r = await a.run(() => pPost<{ id: string }>('/announcements', { ...f, startsAt: starts.toISOString(), endsAt: ends.toISOString() }));
            if (r) {
              toast(t('plat.ann.published'));
              setSent([{ id: r.id, title: f.titleAr }, ...sent]);
              setF(blank());
            }
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label={t('plat.ann.titleAr')} value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} required minLength={2} dir="rtl" lang="ar" />
            <TextField label={t('plat.ann.titleEn')} value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} dir="ltr" lang="en" />
            <TextAreaField label={t('plat.ann.bodyAr')} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} required minLength={2} rows={3} dir="rtl" lang="ar" />
            <TextAreaField label={t('plat.ann.bodyEn')} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} rows={3} dir="ltr" lang="en" />
            <SelectField label={t('plat.ann.severity')} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} options={['info', 'warning', 'maintenance'].map((s) => ({ value: s, label: t(`plat.ann.sev.${s}`) }))} />
            <div />
            <TextField label={t('plat.ann.starts')} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
            <TextField label={t('plat.ann.ends')} type="datetime-local" value={f.endsAt} min={f.startsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required />
          </div>
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <Button type="submit" className="self-start" disabled={a.busy}>
            {t('plat.ann.publish')}
          </Button>
        </form>
        {sent.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-sm">
            {sent.map((s) => (
              <li key={s.id}>
                {t('plat.ann.sentItem')}: <span dir="rtl">{s.title}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">{t('plat.ann.noListGap')}</p>
      </Section>
    </div>
  );
}
