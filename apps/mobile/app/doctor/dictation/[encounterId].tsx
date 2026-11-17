import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { ActionButton, Banner, Button, Chip, ErrorBox, Field, Muted, Row, Screen, Section, T, colors, s } from '../../../components/ui';
import { isApiError } from '../../../lib/api';
import { DICTATION_RECORDING, MAX_AUDIO_BYTES, MAX_RECORDING_MS, MIN_RECORDING_MS, clock, dictationForm, type DictationLanguage } from '../../../lib/dictation';
import { staffApi } from '../../../lib/endpoints';
import { useI18n, type TKey } from '../../../lib/i18n';
import { useClinicalScreen } from '../../../lib/screenCapture';
import { useAction } from '../../../lib/useQuery';

const LANGS: { id: DictationLanguage; key: TKey }[] = [
  { id: 'auto', key: 'ai.langAuto' },
  { id: 'ar', key: 'settings.arabic' },
  { id: 'en', key: 'settings.english' },
];

type Phase = 'idle' | 'starting' | 'recording' | 'recorded';
type Permission = 'unknown' | 'granted' | 'denied' | 'blocked';

/**
 * AI scribe input (POST /v1/encounters/:id/ai/dictation). Two ways in:
 * - **Record** (expo-audio): record → stop → upload as multipart `audio` with `language`. The API transcribes it.
 * - **Type** (or the OS keyboard's voice input): JSON `{text, language}`.
 * Either way the result is a draft that the doctor reviews on the next screen; nothing is written yet.
 * Dictation is PHI: the text lives only in component state, the recording only in the app's private cache until it
 * is uploaded or discarded, and nothing is logged (SEC-11).
 */
export default function Dictation() {
  useClinicalScreen('dictation');
  const { encounterId } = useLocalSearchParams<{ encounterId: string }>();
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [lang, setLang] = useState<DictationLanguage>(locale === 'en' ? 'en' : 'auto');
  const act = useAction();
  const len = text.trim().length;

  const recorder = useAudioRecorder(DICTATION_RECORDING);
  const rec = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const [clip, setClip] = useState<{ uri: string; ms: number; bytes: number } | null>(null);
  const [perm, setPerm] = useState<Permission>('unknown');
  const [note, setNote] = useState<TKey | null>(null);
  const stopping = useRef(false);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => {
    getRecordingPermissionsAsync()
      .then((p) => setPerm(p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'blocked'))
      .catch(() => undefined);
  }, []);

  const start = async () => {
    setNote(null);
    act.setError(null);
    try {
      let p = await getRecordingPermissionsAsync();
      if (!p.granted && p.canAskAgain) p = await requestRecordingPermissionsAsync();
      if (!p.granted) {
        setPerm(p.canAskAgain ? 'denied' : 'blocked');
        return;
      }
      setPerm('granted');
      go('starting');
      setClip(null);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      go('recording');
    } catch {
      go('idle');
      setNote('ai.recordFailed');
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  };

  /** Stops the recorder; keeps the clip for upload, or discards it (cancel / too short). */
  const stop = useCallback(
    async (keep: boolean, why: TKey | null = null) => {
      if (stopping.current || (phaseRef.current !== 'recording' && phaseRef.current !== 'starting')) return;
      stopping.current = true;
      const status = recorder.getStatus();
      try {
        await recorder.stop();
      } catch {
        /* already stopped (e.g. interrupted by a call) */
      }
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      stopping.current = false;
      const uri = recorder.uri;
      const ms = status.durationMillis;
      if (!keep || !uri) {
        go('idle');
        setClip(null);
        setNote(why);
        return;
      }
      if (ms < MIN_RECORDING_MS) {
        go('idle');
        setClip(null);
        setNote('ai.recordTooShort');
        return;
      }
      setClip({ uri, ms, bytes: status.fileSize ?? 0 });
      go('recorded');
      setNote(why);
    },
    [recorder],
  );

  // Cap the length; stop (keeping the clip) when the app leaves the foreground, since background recording is off.
  useEffect(() => {
    if (phase === 'recording' && rec.durationMillis >= MAX_RECORDING_MS) void stop(true, 'ai.recordLimit');
  }, [phase, rec.durationMillis, stop]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && phaseRef.current === 'recording') void stop(true, 'ai.recordInterrupted');
    });
    return () => sub.remove();
  }, [stop]);
  useEffect(
    () => () => {
      if (phaseRef.current === 'recording') {
        recorder.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
    },
    [recorder],
  );

  const toDraft = (id: string) => router.replace({ pathname: '/doctor/draft/[id]', params: { id } });

  const submitText = () =>
    void act.run(async () => {
      const d = await staffApi.dictation(encounterId!, text.trim(), lang);
      setText('');
      toDraft(d.id);
    });

  const tooBig = !!clip && clip.bytes > MAX_AUDIO_BYTES;
  const submitAudio = () =>
    void act.run(async () => {
      if (!clip) return;
      const d = await staffApi.dictationAudio(encounterId!, await dictationForm(clip.uri, lang));
      setClip(null);
      go('idle');
      toDraft(d.id);
    });

  const disabled = isApiError(act.error, 'ai_assistance_disabled');
  const recording = phase === 'recording' || phase === 'starting';
  const elapsed = clock(phase === 'recording' ? rec.durationMillis : 0);

  return (
    <Screen>
      <Banner kind="info">{t('ai.dictationIntro')}</Banner>
      <Section title={t('ai.language')}>
        <View style={s.wrap}>
          {LANGS.map((l) => (
            <Chip key={l.id} label={t(l.key)} selected={lang === l.id} onPress={() => setLang(l.id)} />
          ))}
        </View>
      </Section>

      <Section title={t('ai.recordTitle')}>
        {perm === 'blocked' || perm === 'denied' ? (
          <View>
            <Banner kind="warn">{t(perm === 'blocked' ? 'ai.micBlocked' : 'ai.micDenied')}</Banner>
            {perm === 'blocked' ? <Button kind="secondary" title={t('ai.openSettings')} onPress={() => void Linking.openSettings()} /> : null}
          </View>
        ) : null}
        {note ? <Banner kind={note === 'ai.recordFailed' ? 'danger' : 'info'}>{t(note)}</Banner> : null}

        {recording ? (
          <View>
            <Row style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger, marginEnd: 8 }} />
              <T style={{ fontWeight: '700' }}>{t('ai.recording')}</T>
              <T ltr style={{ marginStart: 8, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] }} accessibilityLabel={t('ai.recordingTime', { time: elapsed })}>
                {elapsed}
              </T>
            </Row>
            <Muted style={{ marginBottom: 8 }}>{t('ai.recordLimitHint', { minutes: MAX_RECORDING_MS / 60000 })}</Muted>
            <Button title={t('ai.stopRecording')} onPress={() => void stop(true)} disabled={phase !== 'recording'} accessibilityHint={t('ai.stopRecordingHint')} />
            <Button kind="ghost" title={t('ai.cancelRecording')} onPress={() => void stop(false, 'ai.recordCancelled')} />
          </View>
        ) : clip ? (
          <View>
            <Row style={{ alignItems: 'center', marginBottom: 8 }}>
              <T style={{ fontWeight: '700' }}>{t('ai.recordingReady')}</T>
              <T ltr style={{ marginStart: 8, fontWeight: '700' }}>
                {clock(clip.ms)}
              </T>
            </Row>
            {tooBig ? <Banner kind="danger">{t('error.file_too_large')}</Banner> : null}
            <ActionButton title={t('ai.sendRecording')} onPress={submitAudio} loading={act.busy} disabled={disabled || tooBig} accessibilityHint={t('ai.sendRecordingHint')} />
            <Button
              kind="secondary"
              title={t('ai.discardRecording')}
              disabled={act.busy}
              onPress={() => {
                setClip(null);
                go('idle');
              }}
            />
          </View>
        ) : (
          <View>
            <Button title={t('ai.startRecording')} onPress={() => void start()} disabled={disabled || act.busy || perm === 'blocked'} accessibilityHint={t('ai.startRecordingHint')} />
            <Muted style={{ marginBottom: 8 }}>{t('ai.recordHint')}</Muted>
          </View>
        )}
      </Section>

      <Section title={t('ai.typeTitle')}>
        <Muted style={{ marginBottom: 12 }}>{t('ai.voiceHint')}</Muted>
        <Field
          label={t('ai.dictationLabel')}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={20000}
          autoCorrect
          placeholder={t('ai.dictationPlaceholder')}
          style={{ minHeight: 180 }}
          error={len > 0 && len < 5 ? t('ai.tooShort') : null}
        />
        <Muted ltr style={{ marginBottom: 8 }}>{`${len} / 20000`}</Muted>
        <ActionButton title={t('ai.createDraft')} onPress={submitText} loading={act.busy && !clip} disabled={len < 5 || disabled || recording || act.busy} accessibilityHint={t('ai.createDraftHint')} />
      </Section>

      <ErrorBox error={act.error} />
      {disabled ? <Muted style={{ marginBottom: 8 }}>{t('ai.disabledHint')}</Muted> : null}
      {act.busy ? <Muted style={{ textAlign: 'center' }}>{t(clip ? 'ai.transcribing' : 'ai.working')}</Muted> : null}
      <Button
        kind="ghost"
        title={t('common.cancel')}
        onPress={() => {
          if (recording) void stop(false);
          router.back();
        }}
      />
    </Screen>
  );
}
