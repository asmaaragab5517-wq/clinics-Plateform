import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { T, colors } from './ui';
import { useI18n } from '../lib/i18n';

/** Header button that opens the mode/clinic switcher. */
export function ModeButton() {
  const { t } = useI18n();
  return (
    <Pressable onPress={() => router.push('/mode')} accessibilityRole="button" accessibilityLabel={t('mode.switch')} hitSlop={12} style={{ paddingHorizontal: 8 }}>
      <T style={{ color: colors.primary, fontWeight: '600' }}>{t('mode.switch')}</T>
    </Pressable>
  );
}
