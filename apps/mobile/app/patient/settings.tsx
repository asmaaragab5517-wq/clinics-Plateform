import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router } from 'expo-router';
import type { ConsentType } from '@hf/shared';
import { ActionButton, Banner, Button, Card, Chip, ErrorBox, Loading, Muted, Row, Screen, Section, T, s } from '../../components/ui';
import { portalApi } from '../../lib/endpoints';
import { patientName } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { biometricAvailable, useLock } from '../../lib/lock';
import { registerForPush } from '../../lib/push';
import { useSession } from '../../lib/session';
import { useAction, useQuery } from '../../lib/useQuery';
import type { NotificationPreferences } from '../../lib/types';

const CHANNELS: NotificationPreferences['channels'] = ['whatsapp', 'sms', 'push', 'email'];

function SwitchRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row style={{ alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
      <T style={{ flex: 1, marginEnd: 8 }}>{label}</T>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </Row>
  );
}

/** Settings: language, biometric unlock, notification preferences, consents, account deletion (FR-APP-1/4). */
export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const lock = useLock();
  const ses = useSession();
  const me = useQuery('portal:me', portalApi.me);
  const consents = useQuery('consents', portalApi.consents);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState(false);
  const act = useAction();
  const patients = me.data?.patients ?? [];
  const pid = patientId ?? patients[0]?.id ?? null;
  const prefs = useQuery(pid ? `prefs:${pid}` : null, () => portalApi.preferences(pid!));
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);

  useEffect(() => {
    void biometricAvailable().then(setBioOk);
  }, []);
  useEffect(() => setDraft(prefs.data), [prefs.data]);

  const savePrefs = (p: NotificationPreferences) => {
    setDraft(p);
    void act.run(async () => {
      await portalApi.setPreferences(pid!, { channels: p.channels, marketingOptOut: p.marketing_opt_out, smsOptOut: p.sms_opt_out, whatsappOptOut: p.whatsapp_opt_out });
      if (p.channels.includes('push')) await registerForPush({ prompt: true });
    });
  };

  const changeLanguage = (l: 'ar' | 'en') =>
    void (async () => {
      await setLocale(l);
      await portalApi.setLocale(l).catch(() => undefined);
    })();

  const setConsent = (type: ConsentType, granted: boolean) => {
    const v = consents.data?.versions.find((x) => x.type === type);
    if (!v || !pid) return;
    void act.run(async () => {
      await portalApi.giveConsent({ patientId: pid, type, granted, versionId: v.id });
      await consents.reload();
    });
  };

  const deleteAccount = () =>
    Alert.alert(t('settings.deleteTitle'), t('settings.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteConfirm'),
        style: 'destructive',
        onPress: () =>
          void act.run(async () => {
            await portalApi.deleteAccount();
            await ses.signOutPatient({ remote: false });
            Alert.alert(t('settings.deleteDone'));
            router.replace('/');
          }),
      },
    ]);

  return (
    <Screen>
      <ErrorBox error={act.error} />
      <Section title={t('settings.language')}>
        <View style={s.wrap}>
          <Chip label={t('settings.arabic')} selected={locale === 'ar'} onPress={() => changeLanguage('ar')} />
          <Chip label={t('settings.english')} selected={locale === 'en'} onPress={() => changeLanguage('en')} />
        </View>
      </Section>

      <Section title={t('settings.security')}>
        <SwitchRow
          label={t('settings.biometric')}
          value={lock.enabled}
          disabled={!bioOk && !lock.enabled}
          onChange={(v) => void lock.setEnabled(v, t('lock.prompt')).then((ok) => !ok && v && Alert.alert(t('settings.biometricUnavailable')))}
        />
        {!bioOk ? <Muted>{t('settings.biometricUnavailable')}</Muted> : null}
      </Section>

      {patients.length > 1 ? (
        <View style={s.wrap}>
          {patients.map((p) => (
            <Chip key={p.id} label={patientName(p, locale)} selected={pid === p.id} onPress={() => setPatientId(p.id)} />
          ))}
        </View>
      ) : null}

      <Section title={t('settings.notifications')}>
        {!pid && me.data ? <Banner kind="info">{t('family.addSelfFirst')}</Banner> : null}
        {prefs.loading && !draft ? <Loading /> : null}
        {draft ? (
          <Card>
            {CHANNELS.map((c) => (
              <SwitchRow
                key={c}
                label={t(`channel.${c}`)}
                value={draft.channels.includes(c)}
                onChange={(on) => {
                  const channels = on ? [...draft.channels, c] : draft.channels.filter((x) => x !== c);
                  if (channels.length) savePrefs({ ...draft, channels });
                }}
              />
            ))}
            <SwitchRow label={t('settings.marketingOptOut')} value={draft.marketing_opt_out} onChange={(v) => savePrefs({ ...draft, marketing_opt_out: v })} />
            <SwitchRow label={t('settings.smsOptOut')} value={draft.sms_opt_out} onChange={(v) => savePrefs({ ...draft, sms_opt_out: v })} />
            <SwitchRow label={t('settings.whatsappOptOut')} value={draft.whatsapp_opt_out} onChange={(v) => savePrefs({ ...draft, whatsapp_opt_out: v })} />
            <Muted>{t('settings.transactionalNote')}</Muted>
          </Card>
        ) : null}
      </Section>

      <Section title={t('settings.consents')}>
        <ErrorBox error={consents.error} />
        {(consents.data?.versions ?? []).map((v) => {
          const given = consents.data?.consents.find((c) => c.patient_id === pid && c.type === v.type);
          return (
            <Card key={v.id}>
              <SwitchRow label={t(`consent.${v.type}`)} value={!!given?.granted} onChange={(on) => setConsent(v.type, on)} disabled={!pid} />
              <Muted>{locale === 'en' ? v.text_en || v.text_ar : v.text_ar}</Muted>
              {given?.needsReconsent ? <Banner kind="warn">{t('settings.reconsent')}</Banner> : null}
            </Card>
          );
        })}
      </Section>

      <Section title={t('settings.account')}>
        {ses.modes.length > 1 ? <Button kind="secondary" title={t('mode.switch')} onPress={() => router.push('/mode')} /> : null}
        <Button kind="secondary" title={t('nav.signOut')} onPress={() => void ses.signOutPatient().then(() => router.replace('/'))} />
        <ActionButton kind="danger" title={t('settings.deleteAccount')} onPress={deleteAccount} loading={act.busy} />
      </Section>
    </Screen>
  );
}
