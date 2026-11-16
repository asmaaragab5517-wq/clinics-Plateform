import { Button } from './ui';
import { useI18n } from '../lib/i18n';

/** Switches ar ⇄ en. `lang.switch` in the shared catalogue is the *other* language's name. */
export function LanguageToggle() {
  const { t, locale, setLocale } = useI18n();
  return <Button kind="ghost" title={t('lang.switch')} accessibilityHint={t('settings.language')} onPress={() => void setLocale(locale === 'ar' ? 'en' : 'ar')} />;
}
