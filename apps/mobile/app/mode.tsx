import { router } from 'expo-router';
import { Banner, Button, Card, Chip, ErrorBox, H2, Muted, Row, Screen, Section, T, colors, s } from '../components/ui';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../lib/i18n';
import { useSession, type Mode } from '../lib/session';
import { View } from 'react-native';

/** Mode switcher (D4) and clinic switching for staff. Modes come from the sessions and /v1/auth/me roles. */
export default function ModeScreen() {
  const { t, pick } = useI18n();
  const ses = useSession();
  const labels: Record<Mode, { title: string; body: string }> = {
    patient: { title: t('mode.patient'), body: t('mode.patientBody') },
    doctor: { title: t('mode.doctor'), body: t('mode.doctorBody') },
    reception: { title: t('mode.reception'), body: t('mode.receptionBody') },
  };
  const open = async (m: Mode) => {
    await ses.setMode(m);
    router.replace(`/${m}`);
  };

  return (
    <Screen>
      <Section title={t('mode.choose')}>
        {ses.modes.length === 0 ? <Banner kind="info">{t('mode.none')}</Banner> : null}
        {ses.modes.map((m) => (
          <Card key={m} onPress={() => void open(m)} accessibilityLabel={labels[m].title} style={ses.mode === m ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
            <T style={{ fontWeight: '700', fontSize: 18 }}>{labels[m].title}</T>
            <Muted>{labels[m].body}</Muted>
          </Card>
        ))}
      </Section>

      {ses.staffSignedIn && ses.staffError && !ses.staff ? <ErrorBox error={ses.staffError} onRetry={() => void ses.reloadStaff()} /> : null}

      {ses.staff && ses.clinics.length > 0 ? (
        <Section title={t('mode.clinic')}>
          <Muted style={{ marginBottom: 8 }}>{ses.staff.name}</Muted>
          <View style={s.wrap}>
            {ses.clinics.map((c) => (
              <Chip key={c.id} label={pick(c)} selected={ses.clinicId === c.id} onPress={() => void ses.setClinic(c.id)} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title={t('mode.accounts')}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <H2>{t('mode.patientAccount')}</H2>
        </Row>
        {ses.hasPatient ? (
          <Button kind="secondary" title={t('nav.signOut')} onPress={() => void ses.signOutPatient()} />
        ) : (
          <Button kind="secondary" title={t('auth.patientSignIn')} onPress={() => router.push('/sign-in')} />
        )}
        <H2>{t('mode.staffAccount')}</H2>
        {ses.staffSignedIn ? (
          <Button kind="secondary" title={t('auth.staffSignOut')} onPress={() => void ses.signOutStaff()} />
        ) : (
          <Button kind="secondary" title={t('auth.staffLogin')} onPress={() => router.push('/staff-sign-in')} />
        )}
      </Section>
      <LanguageToggle />
    </Screen>
  );
}
