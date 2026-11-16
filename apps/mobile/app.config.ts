import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * HealthFlow Clinics mobile app (BR-11, FR-APP-1..6). One binary, role-based modes (D4).
 * Build-time env (not embedded in the JS bundle): APP_LINK_DOMAINS, APPLE_TEAM_ID, CERT_PIN_HOST, CERT_PINS,
 * CERT_PIN_EXPIRES, HF_FLAG_SECURE. Runtime env: EXPO_PUBLIC_* (see .env.example).
 */
const env = process.env;
const linkDomains = (env.APP_LINK_DOMAINS ?? 'healthflow.eg,www.healthflow.eg')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

/** Paths that SMS/WhatsApp messages and the payment return URL point to (FR-APP-5). */
const LINK_PATH_PREFIXES = ['/book/result', '/appointments', '/review', '/reports', '/rx'];

const pins = (env.CERT_PINS ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'HealthFlow Clinics',
  slug: 'healthflow-clinics',
  scheme: 'healthflow',
  version: '0.1.0',
  orientation: 'default', // phones portrait; reception tablets may rotate
  userInterfaceStyle: 'light',
  runtimeVersion: { policy: 'appVersion' },
  // Localised iOS permission prompts / display name.
  locales: { ar: './i18n/native/ar.json', en: './i18n/native/en.json' },
  ios: {
    bundleIdentifier: 'eg.healthflow.clinics',
    supportsTablet: true,
    associatedDomains: linkDomains.map((d) => `applinks:${d}`),
    infoPlist: {
      CFBundleDevelopmentRegion: 'ar',
      CFBundleLocalizations: ['ar', 'en'],
      // FR-APP-4: no cleartext traffic. ATS stays at its secure default (no arbitrary loads).
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'eg.healthflow.clinics',
    allowBackup: false, // tokens and cached PHI must not leave the device via Google backup
    softwareKeyboardLayoutMode: 'resize',
    permissions: ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'android.permission.USE_BIOMETRIC'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true, // App Links: requires /.well-known/assetlinks.json on each domain
        category: ['BROWSABLE', 'DEFAULT'],
        data: linkDomains.flatMap((host) => LINK_PATH_PREFIXES.map((pathPrefix) => ({ scheme: 'https', host, pathPrefix }))),
      },
    ],
  },
  plugins: [
    'expo-router',
    ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: 'يستخدم التطبيق Face ID لفتح حسابك بأمان.' }],
    ['expo-localization', { supportsRTL: true, supportedLocales: { ios: ['ar', 'en'], android: ['ar', 'en'] } }],
    [
      'expo-camera',
      {
        cameraPermission: 'يستخدم التطبيق الكاميرا لمسح رمز QR الخاص بالحجز عند تسجيل الوصول.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    ['expo-local-authentication', { faceIDPermission: 'يستخدم التطبيق Face ID لفتح حسابك بأمان.' }],
    ['expo-notifications', { color: '#0F766E', defaultChannel: 'default' }],
    'expo-web-browser',
    [
      './plugins/withSecurityHardening',
      {
        // SEC-10 / FR-APP-4: OS-level TLS pinning (Android network-security-config pin-set, iOS NSPinnedDomains),
        // cleartext disabled, optional FLAG_SECURE on the Android activity.
        pinHost: env.CERT_PIN_HOST ?? 'api.healthflow.eg',
        pins,
        pinExpiration: env.CERT_PIN_EXPIRES ?? '2027-12-31',
        flagSecure: env.HF_FLAG_SECURE === '1',
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    linkDomains,
    eas: { projectId: env.EAS_PROJECT_ID },
  },
});
