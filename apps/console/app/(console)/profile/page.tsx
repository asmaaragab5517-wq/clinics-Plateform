'use client';

import { useState } from 'react';
import { Alert, Bdi, Button, PageHeader } from '@hf/ui';
import { Section, TextField, useAction } from '@/components/common';
import { useI18n } from '@/components/i18n';
import { useSession } from '@/components/session';
import { useToast } from '@/components/toast';
import { post } from '@/lib/api';
import { biName } from '@/lib/format';

/** Profile: roles and clinics, and the quick-unlock PIN used after the 30-minute idle lock (IAM-2). */
export default function ProfilePage() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const a = useAction();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.profile')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('prof.me')}>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t('staff.name')}</dt>
              <dd>
                <Bdi>{me.name}</Bdi>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('staff.roles')}</dt>
              <dd>{me.roles.map((r) => t(`role.${r}`)).join(t('common.listSep'))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('staff.clinics')}</dt>
              <dd>{me.network ? t('staff.orgWide') : me.clinics.map((c) => biName(c, locale)).join(t('common.listSep'))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{t('prof.privileges')}</dt>
              <dd className="num">{me.privileges.length}</dd>
            </div>
          </dl>
        </Section>
        <Section title={t('prof.pin')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!/^\d{4,8}$/.test(pin)) return a.setError(t('prof.pinRule'));
              if (pin !== confirm) return a.setError(t('prof.pinMismatch'));
              const r = await a.run(() => post('/auth/pin', { pin }));
              if (r) {
                toast(t('prof.pinSaved'));
                setPin('');
                setConfirm('');
              }
            }}
          >
            <p className="text-sm text-muted">{t('prof.pinHint')}</p>
            <TextField label={t('prof.newPin')} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} dir="ltr" />
            <TextField label={t('prof.confirmPin')} type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} dir="ltr" />
            {a.error && <Alert tone="danger">{a.error}</Alert>}
            <Button type="submit" disabled={a.busy}>
              {t('common.save')}
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}
