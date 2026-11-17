import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ActionButton, Banner, Button, Chip, ErrorBox, Field, Muted, Screen, Section, s } from '../../../components/ui';
import { isApiError } from '../../../lib/api';
import { staffApi } from '../../../lib/endpoints';
import { useI18n, type TKey } from '../../../lib/i18n';
import { useClinicalScreen } from '../../../lib/screenCapture';
import { useAction } from '../../../lib/useQuery';

type Lang = 'auto' | 'ar' | 'en';
const LANGS: { id: Lang; key: TKey }[] = [
  { id: 'auto', key: 'ai.langAuto' },
  { id: 'ar', key: 'settings.arabic' },
  { id: 'en', key: 'settings.english' },
];

/**
 * AI scribe input (POST /v1/encounters/:id/ai/dictation, JSON `{text, language}`). Dictation is typed, or spoken
 * through the OS keyboard's own voice input (the microphone key); the app records no audio because no audio
 * module is installed. The result is a draft that the doctor reviews on the next screen; nothing is written yet.
 * The text is PHI: it is sent once and kept only in component state (SEC-11).
 */
export default function Dictation() {
  useClinicalScreen('dictation');
  const { encounterId } = useLocalSearchParams<{ encounterId: string }>();
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [lang, setLang] = useState<Lang>(locale === 'en' ? 'en' : 'auto');
  const act = useAction();
  const len = text.trim().length;

  const submit = () =>
    void act.run(async () => {
      const d = await staffApi.dictation(encounterId!, text.trim(), lang);
      setText('');
      router.replace({ pathname: '/doctor/draft/[id]', params: { id: d.id } });
    });

  const disabled = isApiError(act.error, 'ai_assistance_disabled');

  return (
    <Screen>
      <Banner kind="info">{t('ai.dictationIntro')}</Banner>
      <Muted style={{ marginBottom: 12 }}>{t('ai.voiceHint')}</Muted>
      <Section title={t('ai.language')}>
        <View style={s.wrap}>
          {LANGS.map((l) => (
            <Chip key={l.id} label={t(l.key)} selected={lang === l.id} onPress={() => setLang(l.id)} />
          ))}
        </View>
      </Section>
      <Field
        label={t('ai.dictationLabel')}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={20000}
        autoCorrect
        placeholder={t('ai.dictationPlaceholder')}
        style={{ minHeight: 220 }}
        error={len > 0 && len < 5 ? t('ai.tooShort') : null}
      />
      <Muted ltr style={{ marginBottom: 8 }}>{`${len} / 20000`}</Muted>
      <ErrorBox error={act.error} />
      {disabled ? <Muted style={{ marginBottom: 8 }}>{t('ai.disabledHint')}</Muted> : null}
      <ActionButton title={t('ai.createDraft')} onPress={submit} loading={act.busy} disabled={len < 5 || disabled} accessibilityHint={t('ai.createDraftHint')} />
      {act.busy ? <Muted style={{ textAlign: 'center' }}>{t('ai.working')}</Muted> : null}
      <Button kind="ghost" title={t('common.cancel')} onPress={() => router.back()} />
    </Screen>
  );
}
