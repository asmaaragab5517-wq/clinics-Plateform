import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, OfflineError } from '../lib/api';
import { hasKey, useI18n } from '../lib/i18n';
import { isOnline, onOnlineChange } from '../lib/net';

/**
 * RTL-first primitives (LOC-2): only logical properties (marginStart/End, paddingStart/End, start/end),
 * flexDirection 'row' (mirrored by I18nManager), textAlign 'auto' and explicit writingDirection.
 */
export const colors = {
  primary: '#0F766E',
  primaryDark: '#115E59',
  bg: '#F6F7F9',
  card: '#FFFFFF',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  danger: '#B91C1C',
  dangerBg: '#FEE2E2',
  warn: '#92400E',
  warnBg: '#FEF3C7',
  info: '#1E3A8A',
  infoBg: '#DBEAFE',
  success: '#166534',
  successBg: '#DCFCE7',
};

export function useOnline() {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => onOnlineChange(setOnline), []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <View style={[s.banner, { backgroundColor: colors.warnBg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <T style={{ color: colors.warn, fontWeight: '600' }}>{t('offline.banner')}</T>
    </View>
  );
}

export function T({ style, children, ltr, ...rest }: { style?: StyleProp<TextStyle>; children?: ReactNode; ltr?: boolean; numberOfLines?: number; accessibilityLabel?: string; selectable?: boolean }) {
  const { isRTL } = useI18n();
  // `ltr` isolates Western-digit codes, phone numbers and Latin names inside Arabic UI.
  return <Text {...rest} style={[s.text, { writingDirection: ltr ? 'ltr' : isRTL ? 'rtl' : 'ltr' }, style]}>{children}</Text>;
}

export const H1 = ({ children }: { children: ReactNode }) => (
  <T style={s.h1} accessibilityLabel={typeof children === 'string' ? children : undefined}>
    {children}
  </T>
);
export const H2 = ({ children }: { children: ReactNode }) => <T style={s.h2}>{children}</T>;
export const Muted = ({ children, style, ltr }: { children: ReactNode; style?: StyleProp<TextStyle>; ltr?: boolean }) => (
  <T style={[s.muted, style]} ltr={ltr}>
    {children}
  </T>
);

export function Screen({ children, scroll = true, refreshing, onRefresh, footer }: { children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; footer?: ReactNode }) {
  return (
    <SafeAreaView style={s.screen} edges={['bottom', 'left', 'right']}>
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.content, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.row, style]}>{children}</View>;
}

/** Direction-aware chevron: points to the reading-forward side (left in Arabic, right in English). */
export function Chevron({ back = false }: { back?: boolean }) {
  const { isRTL } = useI18n();
  const forward = isRTL ? '‹' : '›';
  const backward = isRTL ? '›' : '‹';
  return (
    <Text style={s.chevron} accessibilityElementsHidden importantForAccessibility="no">
      {back ? backward : forward}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ title, onPress, kind = 'primary', disabled, loading, style, accessibilityHint }: { title: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; accessibilityHint?: string }) {
  const bg = { primary: colors.primary, secondary: colors.card, danger: colors.danger, ghost: 'transparent' }[kind];
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'ghost' ? colors.primary : colors.text;
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [s.button, { backgroundColor: bg, borderColor: kind === 'secondary' ? colors.border : bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <T style={{ color: fg, fontWeight: '600', textAlign: 'center' }}>{title}</T>}
    </Pressable>
  );
}

/** Buttons that change server state are disabled while offline (FR-APP-6). */
export function ActionButton(props: Parameters<typeof Button>[0]) {
  const online = useOnline();
  return <Button {...props} disabled={props.disabled || !online} />;
}

export function Field({ label, error, ltr, ...input }: TextInputProps & { label: string; error?: string | null; ltr?: boolean }) {
  const { isRTL } = useI18n();
  return (
    <View style={{ marginBottom: 12 }}>
      <T style={s.label}>{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...input}
        style={[s.input, { textAlign: 'auto', writingDirection: ltr ? 'ltr' : isRTL ? 'rtl' : 'ltr' }, input.multiline && { minHeight: 90, textAlignVertical: 'top' }, input.style]}
      />
      {error ? <T style={{ color: colors.danger, marginTop: 4 }}>{error}</T> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      style={[s.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
    >
      <T style={{ color: selected ? '#fff' : colors.text }}>{label}</T>
    </Pressable>
  );
}

export function ListItem({ title, subtitle, end, onPress, accessibilityLabel }: { title: string; subtitle?: string | null; end?: ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  const body = (
    <Row style={{ alignItems: 'center' }}>
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '600' }}>{title}</T>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {end}
      {onPress ? <Chevron /> : null}
    </Row>
  );
  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}>
      {body}
    </Card>
  );
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode }) {
  const map = { info: [colors.infoBg, colors.info], warn: [colors.warnBg, colors.warn], danger: [colors.dangerBg, colors.danger], success: [colors.successBg, colors.success] } as const;
  const [bg, fg] = map[kind];
  return (
    <View style={[s.banner, { backgroundColor: bg, borderRadius: 10, marginBottom: 12 }]} accessibilityRole={kind === 'danger' ? 'alert' : undefined}>
      <T style={{ color: fg, fontWeight: '600' }}>{children}</T>
    </View>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <View style={{ padding: 24, alignItems: 'center' }} accessibilityLabel={t('common.loading')}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useI18n();
  return <Muted style={{ textAlign: 'center', padding: 24 }}>{text ?? t('common.empty')}</Muted>;
}

/** Translate an error to a user message: API code → `error.<code>`, offline → offline text. Never shows raw bodies. */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof OfflineError) return t('offline.action');
    if (e instanceof ApiError) {
      const k = `error.${e.code}`;
      if (hasKey(k)) return t(k);
      if (e.status === 401) return t('error.session_expired');
      if (e.status === 403) return t('error.forbidden');
    }
    return t('common.error');
  };
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = useErrorText();
  const { t } = useI18n();
  if (!error) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      <Banner kind="danger">{msg(error)}</Banner>
      {onRetry ? <Button kind="secondary" title={t('common.retry')} onPress={onRetry} /> : null}
    </View>
  );
}

export function StatusBadge({ label, tone = 'info' }: { label: string; tone?: 'info' | 'warn' | 'danger' | 'success' }) {
  const map = { info: [colors.infoBg, colors.info], warn: [colors.warnBg, colors.warn], danger: [colors.dangerBg, colors.danger], success: [colors.successBg, colors.success] } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginStart: 8 }}>
      <T style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</T>
    </View>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <H2>{title}</H2>
        {action}
      </Row>
      {children}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  text: { color: colors.text, fontSize: 16, textAlign: 'auto' },
  h1: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  h2: { fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  label: { fontSize: 14, color: colors.muted, marginBottom: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row' },
  chevron: { fontSize: 24, color: colors.muted, marginStart: 8 },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text, backgroundColor: colors.card },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginEnd: 8, marginBottom: 8, backgroundColor: colors.card },
  banner: { paddingVertical: 10, paddingHorizontal: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
