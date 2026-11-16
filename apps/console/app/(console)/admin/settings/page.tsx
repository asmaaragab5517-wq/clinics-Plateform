'use client';

import { useEffect, useState } from 'react';
import { MESSAGE_EVENTS } from '@hf/shared';
import { Alert, Button, PageHeader } from '@hf/ui';
import { Check, DataState, Section, SelectField, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { patch } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { egpInput, parseEgp } from '@/lib/format';

interface Settings {
  defaultLocale?: 'ar' | 'en';
  digitStyle?: 'western' | 'arabic_indic';
  hijri?: boolean;
  booking?: Partial<Record<'leadMinutes' | 'cancellationCutoffHours' | 'maxReschedules' | 'rescheduleFee' | 'noShowFee' | 'depositPercent' | 'holdMinutes' | 'noShowAfterMinutes', number>> & { requireOnlinePayment?: boolean };
  reminders?: { hoursBefore: number[] };
  discountApprovalPercent?: number;
  shiftVarianceThreshold?: number;
  queueNotifyPositions?: number;
  mrnFormat?: string;
  messaging?: { disabledEvents?: string[] };
}

const BOOKING_FIELDS = ['leadMinutes', 'cancellationCutoffHours', 'maxReschedules', 'depositPercent', 'holdMinutes', 'noShowAfterMinutes'] as const;

/** FR-ORG-5 organisation settings: language, digit style (D6), booking policies, reminders, thresholds. */
export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<{ name_ar: string; name_en: string; settings: Settings }>('/org');
  const [s, setS] = useState<Settings>({});
  const [reminders, setReminders] = useState('24, 2');
  const [fees, setFees] = useState({ rescheduleFee: '', noShowFee: '', variance: '' });
  const a = useAction();
  useEffect(() => {
    if (!q.data) return;
    const x = q.data.settings ?? {};
    setS(x);
    setReminders((x.reminders?.hoursBefore ?? [24, 2]).join(', '));
    setFees({ rescheduleFee: egpInput(x.booking?.rescheduleFee ?? 0), noShowFee: egpInput(x.booking?.noShowFee ?? 0), variance: egpInput(x.shiftVarianceThreshold ?? 1000) });
  }, [q.data]);
  const b = s.booking ?? {};
  const setB = (k: string, v: number | boolean) => setS({ ...s, booking: { ...b, [k]: v } });
  const disabled = s.messaging?.disabledEvents ?? [];
  const ro = !can('settings:edit');
  return (
    <DataState loading={q.loading} error={q.error} data={q.data}>
      {(org) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const hours = reminders.split(/[,،]/).map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
            const body = {
              defaultLocale: s.defaultLocale,
              digitStyle: s.digitStyle,
              hijri: !!s.hijri,
              booking: { ...b, rescheduleFee: parseEgp(fees.rescheduleFee) ?? 0, noShowFee: parseEgp(fees.noShowFee) ?? 0, requireOnlinePayment: !!b.requireOnlinePayment },
              reminders: { hoursBefore: hours.slice(0, 4) },
              discountApprovalPercent: s.discountApprovalPercent,
              shiftVarianceThreshold: parseEgp(fees.variance) ?? undefined,
              queueNotifyPositions: s.queueNotifyPositions,
              mrnFormat: s.mrnFormat || undefined,
              messaging: { disabledEvents: disabled },
            };
            const r = await a.run(() => patch('/org/settings', body));
            if (r) {
              toast(t('common.saved'));
              q.reload();
            }
          }}
        >
          <PageHeader title={t('nav.settings')} subtitle={org.name_ar} actions={!ro && <Button type="submit" disabled={a.busy}>{t('common.save')}</Button>} />
          {a.error && <Alert tone="danger">{a.error}</Alert>}
          <fieldset disabled={ro} className="grid gap-4 xl:grid-cols-2">
            <Section title={t('set.general')}>
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField label={t('set.defaultLocale')} value={s.defaultLocale ?? 'ar'} onChange={(e) => setS({ ...s, defaultLocale: e.target.value as 'ar' | 'en' })} options={[{ value: 'ar', label: t('set.arabic') }, { value: 'en', label: t('set.english') }]} />
                <SelectField label={t('set.digits')} value={s.digitStyle ?? 'western'} onChange={(e) => setS({ ...s, digitStyle: e.target.value as 'western' | 'arabic_indic' })} options={[{ value: 'western', label: t('set.western') }, { value: 'arabic_indic', label: t('set.arabicIndic') }]} />
                <TextField label={t('set.mrnFormat')} value={s.mrnFormat ?? 'HF-{n:6}'} onChange={(e) => setS({ ...s, mrnFormat: e.target.value })} dir="ltr" hint={t('set.mrnHint')} />
                <Check label={t('set.hijri')} checked={!!s.hijri} onChange={(v) => setS({ ...s, hijri: v })} />
              </div>
            </Section>
            <Section title={t('set.booking')}>
              <div className="grid gap-3 md:grid-cols-2">
                {BOOKING_FIELDS.map((k) => (
                  <TextField key={k} label={t(`set.b.${k}`)} type="number" min={0} value={b[k] ?? ''} onChange={(e) => setB(k, Number(e.target.value))} />
                ))}
                <TextField label={t('set.b.rescheduleFee')} value={fees.rescheduleFee} onChange={(e) => setFees({ ...fees, rescheduleFee: e.target.value })} dir="ltr" />
                <TextField label={t('set.b.noShowFee')} value={fees.noShowFee} onChange={(e) => setFees({ ...fees, noShowFee: e.target.value })} dir="ltr" />
                <Check label={t('set.b.requireOnlinePayment')} checked={!!b.requireOnlinePayment} onChange={(v) => setB('requireOnlinePayment', v)} />
              </div>
            </Section>
            <Section title={t('set.thresholds')}>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label={t('set.discountApproval')} type="number" min={0} max={100} value={s.discountApprovalPercent ?? ''} onChange={(e) => setS({ ...s, discountApprovalPercent: Number(e.target.value) })} />
                <TextField label={t('set.varianceThreshold')} value={fees.variance} onChange={(e) => setFees({ ...fees, variance: e.target.value })} dir="ltr" />
                <TextField label={t('set.queueNotify')} type="number" min={1} max={20} value={s.queueNotifyPositions ?? 3} onChange={(e) => setS({ ...s, queueNotifyPositions: Number(e.target.value) })} />
                <TextField label={t('set.reminders')} value={reminders} onChange={(e) => setReminders(e.target.value)} dir="ltr" hint={t('set.remindersHint')} />
              </div>
            </Section>
            <Section title={t('set.messaging')}>
              <p className="mb-2 text-sm text-muted">{t('set.messagingHint')}</p>
              <div className="grid grid-cols-2 gap-1">
                {MESSAGE_EVENTS.filter((ev) => ev !== 'otp').map((ev) => (
                  <Check key={ev} label={t(`event.${ev}`)} checked={!disabled.includes(ev)} onChange={(on) => setS({ ...s, messaging: { disabledEvents: on ? disabled.filter((x) => x !== ev) : [...disabled, ev] } })} />
                ))}
              </div>
            </Section>
          </fieldset>
        </form>
      )}
    </DataState>
  );
}
