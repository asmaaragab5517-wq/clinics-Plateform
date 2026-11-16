import { View } from 'react-native';
import { T, colors } from './ui';
import { useI18n } from '../lib/i18n';
import type { Allergy } from '../lib/types';

/** FR-EMR-4 allergies banner: always at the top of clinical screens, red when any allergy is recorded. */
export function AllergyBanner({ allergies }: { allergies: Allergy[] | null | undefined }) {
  const { t } = useI18n();
  const list = allergies ?? [];
  const has = list.length > 0;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={has ? `${t('patient.allergies')}: ${list.map((a) => a.text).join(', ')}` : t('emr.noAllergies')}
      style={{ backgroundColor: has ? colors.dangerBg : colors.successBg, borderRadius: 10, padding: 12, marginBottom: 12, borderStartWidth: 4, borderStartColor: has ? colors.danger : colors.success }}
    >
      <T style={{ fontWeight: '700', color: has ? colors.danger : colors.success }}>{has ? t('patient.allergies') : t('emr.noAllergies')}</T>
      {list.map((a, i) => (
        <T key={a.id ?? i} style={{ color: colors.danger }}>
          {[a.text, a.severity ? t(`emr.severity.${a.severity}`) : null].filter(Boolean).join(' · ')}
        </T>
      ))}
    </View>
  );
}
