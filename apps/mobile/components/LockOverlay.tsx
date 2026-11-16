import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../lib/i18n';
import { useLock } from '../lib/lock';
import { Button, H1, Muted, colors } from './ui';

/** Full-screen cover shown while the biometric lock is engaged (hides PHI, also in the app switcher on iOS). */
export function LockOverlay() {
  const { locked, unlock } = useLock();
  const { t } = useI18n();
  useEffect(() => {
    if (locked) void unlock(t('lock.prompt'), t('common.cancel'));
  }, [locked, unlock, t]);
  if (!locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.cover]} accessibilityViewIsModal>
      <H1>{t('lock.title')}</H1>
      <Muted style={{ marginBottom: 24, textAlign: 'center' }}>{t('lock.body')}</Muted>
      <Button title={t('lock.unlock')} onPress={() => void unlock(t('lock.prompt'), t('common.cancel'))} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({ cover: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 } });
