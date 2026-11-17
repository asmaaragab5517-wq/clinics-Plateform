'use client';

import { useState } from 'react';
import { Alert, Badge, Button, DateText, PageHeader, Table } from '@hf/ui';
import { Dialog } from '@/components/dialog';
import { DataState, Section, SelectField, TextAreaField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { pPost } from '@/lib/api';
import { useApi } from '@/lib/hooks';

interface Announcement {
  id: string;
  title_ar: string;
  title_en: string;
  body_ar: string;
  body_en: string;
  severity: 'info' | 'warning' | 'maintenance';
  starts_at: string;
  ends_at: string;
  created_at: string;
}

function localInput(d: Date): string {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}

/** Announcements shown as a banner to every staff user of every organisation while active. */
export default function PlatformAnnouncementsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const blank = () => ({ titleAr: '', titleEn: '', bodyAr: '', bodyEn: '', severity: 'info', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 24 * 3600_000)) });
  const [f, setF] = useState(blank);
  const list = useApi<Announcement[]>('/announcements', true);
  const a = useAction();
  const w = useAction();
  const [withdrawing, setWithdrawing] = useState<Announcement | null>(null);
  const now = Date.now();
  const state = (x: Announcement) => (new Date(x.ends_at).getTime() <= now ? 'ended' : new Date(x.starts_at).getTime() > now ? 'scheduled' : 'active');
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
              setF(blank());
              list.reload();
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
      </Section>
      <Section title={t('plat.ann.list')}>
        {w.error && <Alert tone="danger">{w.error}</Alert>}
        <DataState loading={list.loading} error={list.error} data={list.data} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>{t('plat.ann.titleAr')}</th>
                  <th>{t('plat.ann.severity')}</th>
                  <th>{t('plat.ann.starts')}</th>
                  <th>{t('plat.ann.ends')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const st = state(x);
                  return (
                    <tr key={x.id}>
                      <td>
                        <span dir="rtl" lang="ar" className="font-medium">
                          {x.title_ar}
                        </span>
                        {x.title_en && (
                          <span dir="ltr" lang="en" className="block text-xs text-muted">
                            {x.title_en}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={x.severity === 'info' ? 'primary' : 'warning'}>{t(`plat.ann.sev.${x.severity}`)}</Badge>
                      </td>
                      <td>
                        <DateText value={x.starts_at} locale={locale} withTime />
                      </td>
                      <td>
                        <DateText value={x.ends_at} locale={locale} withTime />
                      </td>
                      <td>
                        <Badge tone={st === 'active' ? 'success' : st === 'scheduled' ? 'primary' : 'neutral'}>{t(`plat.ann.state.${st}`)}</Badge>
                      </td>
                      <td>
                        {st !== 'ended' && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={w.busy}
                            onClick={() => setWithdrawing(x)}
                          >
                            {t('plat.ann.withdraw')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </DataState>
      </Section>
      <Dialog open={!!withdrawing} onClose={() => setWithdrawing(null)} title={t('plat.ann.withdraw')}>
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t('plat.ann.withdrawConfirm')}</p>
          {withdrawing && (
            <p className="text-sm font-medium" dir="rtl" lang="ar">
              {withdrawing.title_ar}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setWithdrawing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={w.busy}
              onClick={async () => {
                if (!withdrawing) return;
                const r = await w.run(() => pPost(`/announcements/${withdrawing.id}/withdraw`));
                setWithdrawing(null);
                if (r) {
                  toast(t('plat.ann.withdrawn'));
                  list.reload();
                }
              }}
            >
              {t('plat.ann.withdraw')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
