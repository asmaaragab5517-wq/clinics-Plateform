import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { reloadAppAsync } from 'expo';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, applyDirection, initialLocale, useI18n } from '../lib/i18n';
import { KEYS, getSecretSync, setSecret } from '../lib/storage';
import { SessionProvider } from '../lib/session';
import { LockProvider } from '../lib/lock';
import { startPushListeners } from '../lib/push';
import { usePushNavigation } from '../lib/pushNavigation';
import { LockOverlay } from '../components/LockOverlay';
import { colors } from '../components/ui';

// Completes a pending auth session when the OIDC redirect re-opens the app (web/Android fallback).
WebBrowser.maybeCompleteAuthSession();

// LOC-2: the first launch in Arabic must flip the native layout to RTL, which needs one reload.
// Reload at most once per target direction so a platform that ignores forceRTL cannot loop.
const bootLocale = initialLocale();
const needsDirectionReload = applyDirection(bootLocale) && getSecretSync(KEYS.rtlReload) !== bootLocale;

function Navigator() {
  const { t } = useI18n();
  usePushNavigation();
  return (
    <Stack
      screenOptions={{
        headerTitleAlign: 'center',
        headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: t('auth.signInTitle') }} />
      <Stack.Screen name="otp" options={{ title: t('auth.code') }} />
      <Stack.Screen name="staff-sign-in" options={{ title: t('auth.staffLogin') }} />
      <Stack.Screen name="mode" options={{ title: t('mode.title') }} />
      <Stack.Screen name="patient" options={{ headerShown: false }} />
      <Stack.Screen name="doctor" options={{ headerShown: false }} />
      <Stack.Screen name="reception" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (needsDirectionReload) void setSecret(KEYS.rtlReload, bootLocale).then(() => reloadAppAsync('rtl'));
  }, []);
  useEffect(() => startPushListeners(), []);
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <LockProvider>
            <View style={{ flex: 1 }}>
              <StatusBar style="dark" />
              <Navigator />
              <LockOverlay />
            </View>
          </LockProvider>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
