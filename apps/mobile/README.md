# HealthFlow Clinics: mobile app (`apps/mobile`)

The Expo React Native app for BR-11 / FR-APP-1..6. It is one binary with role-based modes (decision D4):

| Mode | Session | Shown when |
|---|---|---|
| Patient | Patient OTP session (`/v1/auth/otp/*`) | A patient session exists |
| Doctor | Staff bearer from Keycloak, or a dev token | `GET /v1/auth/me` roles include `doctor` |
| Reception (tablet-first) | Staff bearer | Has `queue:create`, or role receptionist, nurse or clinic_manager |

A device can hold both a patient session and a staff session. The mode switcher (`/mode`) chooses which one drives the UI and also handles clinic switching for staff.

Stack: Expo SDK 58, React Native 0.88, expo-router (file routes in `app/`), `@hf/shared` for i18n, money, dates, phone and statuses. The app uses only the dependencies already in `package.json`.

## Run

```bash
cp .env.example .env          # set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_ORG_SLUG
pnpm --filter @hf/shared build   # the app consumes packages/shared/dist (CommonJS)
cd apps/mobile
npx expo start                # Expo Go / simulator. Native modules are all Expo SDK modules
npx expo run:android          # or run:ios: a local native debug build (prebuild + gradle/xcode)
npx tsc --noEmit              # strict type-check (passes)
node ../../scripts/lint-rtl.mjs .   # LOC-1/LOC-2 lint (passes)
```

Metro is set up for the pnpm monorepo in `metro.config.js`: `watchFolders` = repo root, `nodeModulesPaths` = app and root, with symlinks and package exports enabled. No `babel.config.js` is needed because SDK 58 applies `babel-preset-expo` (including expo-router) by default. `npx expo export --platform android` bundles successfully offline, and `@hf/shared` resolves through the workspace symlink.

In development, the API's `OTP_DEV_ECHO` returns `devCode`, and the OTP screen pre-fills it in `__DEV__` builds only. For staff, `POST /v1/auth/dev/staff-token {"email": …}` with `x-org` gives a token. Paste it under "Staff sign in → Development token". That form only appears when `EXPO_PUBLIC_ALLOW_DEV_STAFF_TOKEN=1` or in dev.

### Environment

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | bundle | API base URL without `/v1`. Must be https in release builds (the app throws at startup otherwise) |
| `EXPO_PUBLIC_ORG_SLUG` | bundle | Sent as `x-org` on every request |
| `EXPO_PUBLIC_KEYCLOAK_ISSUER`, `EXPO_PUBLIC_KEYCLOAK_CLIENT_ID` | bundle | Enable the staff OIDC sign-in |
| `EXPO_PUBLIC_ALLOW_DEV_STAFF_TOKEN` | bundle | `1` shows the paste-a-token form |
| `APP_ENV` | build | `staging`/`production` disable cleartext entirely. Any other value (local/dev) allows http so the app can reach Metro |
| `APP_LINK_DOMAINS` | build | Universal/App Link hosts (default `healthflow.eg,www.healthflow.eg`) |
| `CERT_PIN_HOST`, `CERT_PINS`, `CERT_PIN_EXPIRES` | build | TLS pinning (see below) |
| `HF_FLAG_SECURE` | build | `1` sets Android FLAG_SECURE on the activity |

## Build with EAS

`eas.json` has three profiles: `development` (internal APK / iOS simulator, dev token allowed), `preview` (staging API, internal distribution, FLAG_SECURE) and `production` (store builds, auto-increment, FLAG_SECURE).

```bash
npm i -g eas-cli && eas login
eas init                                 # writes EAS_PROJECT_ID; set it as an EAS env var
eas secret:create --name CERT_PINS --value "<pin1>,<pin2>"   # per environment
eas build --profile preview --platform all
eas build --profile production --platform all
eas submit --profile production --platform android|ios
```

Before the first store build, add `google-services.json` (FCM) and set `android.googleServicesFile`. Configure APNs keys in EAS credentials.

### Store submission notes

- **Google Play**: app bundle (`production`), internal track first. Fill in the Data safety form (health data, phone number; encrypted in transit; deletion request available in-app). Target the API level required by the SDK. `allowBackup=false`.
- **Apple App Store**: `ITSAppUsesNonExemptEncryption=false` (standard TLS only). Fill in the privacy nutrition labels for health and contact data. The account-deletion flow required by App Store Review 5.1.1(v) is under Settings → Request account deletion. Camera and Face ID purpose strings are localised (ar/en) via `i18n/native/*.json`.
- **Universal Links / App Links (FR-APP-5)**: each domain in `APP_LINK_DOMAINS` must serve:
  - `/.well-known/apple-app-site-association` with `applinks.details[].appIDs = ["<TEAM_ID>.eg.healthflow.clinics"]` and `components` limited to `/book/result*`, `/appointments/*`, `/review/*`, `/reports*`, `/rx*`
  - `/.well-known/assetlinks.json` with the Play app-signing SHA-256 fingerprint for `eg.healthflow.clinics`

  The Android intent filter already restricts to those path prefixes (`autoVerify=true`). These files belong in `apps/site` and are not created here.

## Screens (expo-router, `app/`)

- **Auth**:
  - `sign-in` (phone, normalised with `normalisePhone`, accepts Arabic-Indic digits)
  - `otp` (6 digits, 60 s resend countdown; handles `otp_invalid`, `otp_expired`, `otp_attempts_exceeded`, `otp_rate_limited`, `otp_resend_too_soon`)
  - `staff-sign-in` (Keycloak PKCE and/or dev token)
  - `mode` (mode and clinic switcher, account sign-in and sign-out)
- **Patient** (`app/patient/*`):
  - Home: next appointment card with live queue position (polls `/appointments/:id/queue` every 30 s when checked in), plus shortcuts
  - `doctors` (name search, specialty, city and "available by" chips (`availableBy`), public photo, fee, rating, next available slot) and `doctors/[slug]` (photo, profile, clinics, services and prices, reviews, next available)
  - `book/[slug]`: service → clinic (if several) → slot (14 days) → family member → pay online (opens `payment.checkout_url` with expo-web-browser, then polls the result) or pay at clinic. Sends an `Idempotency-Key` per attempt and `x-client: app`
  - `appointments` (upcoming/past) and `appointments/[id]` (loaded with `GET /v1/portal/appointments/:id`; confirm, cancel with reason, reschedule via the slot picker, pay now, rate, report a problem)
  - **Video visit card** (`components/VideoVisitCard.tsx`, on Home and the appointment detail): shown when `GET /v1/portal/appointments/:id/telemedicine` answers (a 400 `not_a_video_consultation` hides it). Waiting-room countdown to `opensAt` (T-10 min), status, a "pay online first" note for `requested` visits (video visits need online payment), and a telemedicine-consent check that links to Settings → Consents (`/patient/settings?focus=consents`, which shows consents first for that patient). **Join** calls `POST …/telemedicine/join`, shows the passcode (alert + card) and opens the URL with expo-web-browser
  - `prescriptions` (in-app view; offline cache) and `invoices`: **PDF** buttons fetch a 10-minute signed link (`GET /v1/portal/prescriptions/:id/link`, `/invoices/:id/link`) on tap and open it in the system browser (`FEATURES.signedPdfUrls = true`)
  - `complaint`: patient, clinic (public clinic list, preselected from an appointment), category and description → `POST /v1/portal/complaints` with `channel: "app"
  - `documents` (reports/results via a signed URL, plus visit summaries)
  - `packages`, `family` (list and add, with relation, four-part Arabic name and consent; confirms reception-created family links with a `link_family` OTP)
  - `review/[id]`, `notifications`, `payment-result`
  - `settings`: language, biometric unlock, per-patient notification preferences, consents with re-consent flag, account deletion request, sign out (this device only, see Push)
- **Doctor** (`app/doctor/*`):
  - Today: the selected clinic's queue for the doctor (now serving, waiting, **Call next**, **Start consultation**), polled every 20 s, plus today's appointments. The encounter is opened by the `encounter_id` on the queue ticket / appointment row
  - `video`: today's/tomorrow's video visits (`GET /v1/telemedicine?date=`), polled every 20 s, with session status and "patient joined". **Start** (`POST /v1/telemedicine/:id/start`) opens the host URL in the system browser and offers the visit's encounter (`encounterId` from the response); **End** closes the session
  - `encounter/[appointmentId]` (params `encounterId`, `patientId`, both optional): loads `encounterId` directly, otherwise reads `encounter_id` from the appointment's row in today's schedule; the patient comes from the encounter when not passed. Allergies banner, demographics, active history, last 3 signed visits; vitals, chief complaint, HPI, examination, notes, ICD-10 search (first diagnosis is primary), save
  - **AI scribe**: `dictation/[encounterId]` takes typed text (doctors can speak through the OS keyboard's own voice input; the app records no audio because no audio module is installed) plus a language (auto/ar/en) and posts `{text, language}` to `POST /v1/encounters/:id/ai/dictation`. `draft/[id]` (`GET /v1/ai/drafts/:id`) is labelled **AI draft, review required**: warnings (unmapped ICD-10, out-of-range vitals) and missing information are listed, and every field (chief complaint, HPI, examination, notes, vitals with client-side range checks, diagnoses with ICD-10 search, follow-up days) is editable. **Approve** sends only the doctor's non-empty values (`POST …/approve`, so empty fields keep the encounter's values); **Reject** discards it. `ai_assistance_disabled`, `ai_declined`, `ai_unavailable`, `draft_expired` and `draft_not_pending` map to messages
  - Prescription from template chips or drug search (or free text), with dose, frequency, duration and instructions. Create → issue, with a safety-warnings acknowledgement dialog
  - **Sign off**: on `reauthentication_required` it runs an interactive Keycloak re-login (`prompt=login`, `max_age=0`) and retries once
  - `earnings`: own commission statements
- **Reception** (`app/reception/*`, two columns on tablets):
  - Clinic queue per doctor, with priority (emergency/elderly) and skip actions; today's arrivals with **Check in**
  - `scan`: expo-camera QR. Accepts an appointment UUID, a booking ref, `healthflow://checkin/<x>`, or a URL with `/appointments/<uuid>` or `?ref=`. Refs are resolved with `GET /v1/appointments?ref=` (today); a booking at another branch is reported as such
  - `search`: patient search by phone, National ID, MRN or name → today's booking → check in
  - `walk-in`: patient → doctor (`GET /v1/doctors?clinicId=`, includes non-public doctors) → service (`GET /v1/services` filtered by the doctor's `service_ids`, active, not telemedicine) → priority → `POST /v1/appointments/walk-in` with an `Idempotency-Key` per attempt (reused on retry, so a timeout cannot issue a second ticket; a replay is shown as such), then shows the ticket number
- **Deep-link routes**: `book/result`, `appointments/[id]`, `review/[id]`, `reports`, `rx` redirect into patient mode. `oauth/callback` is the OIDC redirect.

## i18n and RTL (LOC-1, LOC-2)

- `i18n/{ar,en}.json` are app strings with identical key sets, merged over `packages/shared/src/i18n` (which is not edited). `lib/i18n.tsx` provides `t`, `pick(name_ar/name_en)` and `setLocale`.
- Arabic is the default. English is used only when chosen, or when the device's primary language is English (expo-localization).
- Direction: `I18nManager.forceRTL` plus a one-time automatic reload on first launch (guarded against loops). Switching language asks the user to restart (`reloadAppAsync`).
- Styling uses logical properties only (`marginStart/End`, `paddingStart/End`, `borderStartWidth`), mirrored `flexDirection: 'row'`, `textAlign: 'auto'` and explicit `writingDirection`. Codes, phones and MRNs render LTR-isolated. Chevrons are direction-aware and hidden from screen readers.
- Accessibility: every control has an `accessibilityRole`/`accessibilityLabel`; alerts and banners use `accessibilityRole="alert"`.
- Money, dates and times come from `@hf/shared`: `1,250.00 ج.م`, `dd/MM/yyyy`, 12-hour with ص/م, Africa/Cairo, Western digits.

## API client (`lib/api.ts`, `lib/endpoints.ts`)

- Base URL from `EXPO_PUBLIC_API_URL`, `x-org` on every call, a 20 s timeout, and typed helpers for every route used (`lib/types.ts`).
- Tokens live only in expo-secure-store (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Keychain/Keystore) and in memory.
- On a 401, one single-flight refresh runs, then the request is retried once.
  - Patients use `POST /v1/auth/refresh`, which rotates the token; the new pair is persisted before the retry. An expired or reused token ends the session.
  - Staff use the Keycloak refresh-token grant. Dev tokens cannot refresh.
  - 401s that mean something else (`reauthentication_required`, `otp_*`) are not refreshed.
- SEC-11: there is no logging anywhere. Errors expose only the API error code, which is mapped to `error.<code>` strings. Request and response bodies, tokens, OTPs and PHI are never logged.

## Security (FR-APP-4, SEC-10): what is and is not implemented

| Control | Status |
|---|---|
| Tokens in Keychain/Keystore | **Done**. expo-secure-store only; AsyncStorage is not used. `allowBackup=false`, and secure-store backup exclusion rules are set |
| No cleartext | **Done** for `APP_ENV=staging/production`: Android `usesCleartextTraffic=false` and a network-security-config base-config without cleartext; iOS ATS with `NSAllowsArbitraryLoads=false` and no local-networking exception. The JS also refuses an `http://` API URL in release builds. Dev builds allow http only so they can reach Metro |
| Certificate pinning | **Implemented as OS-level config, not verified on a device.** `plugins/withSecurityHardening.js` writes an Android `<pin-set>` (enforced by the platform TrustManager that OkHttp uses) and iOS `NSPinnedDomains` (`NSPinnedLeafIdentities`, or CA identities with `pinKind: 'ca'`), enforced by NSURLSession. Supply at least two SPKI SHA-256 pins (current + backup) in `CERT_PINS`; the command is in the plugin header. With `CERT_PINS` empty, pinning is **off** (a warning is printed at config time). Verify before release: point a staging build at a host with a non-matching pin and confirm requests fail (they surface as the offline error). Pinning covers only `CERT_PIN_HOST`; the Keycloak host is not pinned |
| Biometric unlock | **Done** (expo-local-authentication). Off by default; enable it in Settings. The app locks at cold start and after 30 s in the background, and an overlay hides the content |
| Screenshot blocking | **Partial.** Per-screen blocking needs `expo-screen-capture`, which is **not installed**, so `lib/screenCapture.ts` (`useClinicalScreen`) is a documented no-op with a TODO. Instead, `HF_FLAG_SECURE=1` (preview/production) makes the plugin add `FLAG_SECURE` to the Android `MainActivity`, which blocks screenshots app-wide. iOS cannot block screenshots |
| Root/jailbreak warning | **Not implemented.** No detection module is installed. Recommended: add Play Integrity / App Attest server-side attestation, or `jail-monkey`, and show a warning banner (not a hard block) on compromised devices |
| Release obfuscation | **Android**: the plugin enables R8 minify + resource shrinking (`android.enableMinifyInReleaseBuilds`, `android.enableShrinkResourcesInReleaseBuilds`). **JS**: shipped as Hermes bytecode (not obfuscated source); a JS obfuscator is out of scope. **iOS**: release builds are stripped by Xcode defaults |
| PKCE randomness | The verifier and state use `uuid.v4()` from `expo` (generated natively from the platform CSPRNG). SHA-256 is a small JS implementation in `lib/sha256.ts`, because expo-crypto is not installed |
| No PHI in logs/analytics | **Done**: no logging and no analytics SDK |

### Keycloak client (staff OIDC)

Client `healthflow-mobile` in realm `healthflow`:

- Public client: Client authentication **off**, Standard flow **on**, Direct access grants **off**.
- PKCE: Advanced → "Proof Key for Code Exchange Code Challenge Method" = **S256**.
- Valid redirect URIs: `healthflow://oauth/callback`. For Expo Go during development, also add `exp://*`.
- Add an audience mapper that adds `healthflow-api` to access tokens, because the API verifies `KEYCLOAK_AUDIENCE`.
- Scopes requested: `openid profile offline_access`. Enable refresh-token rotation in Realm → Tokens.
- Sign-off and prescription issue need `auth_time` within 12 h (IAM-3). The app re-authenticates with `prompt=login&max_age=0` when the API returns `reauthentication_required`.
- The ID token is not validated in-app (the nonce is sent but not checked), because the app uses only the access token, which the API verifies.

## Offline (FR-APP-6)

- Upcoming appointments (max 10) and the latest prescriptions (max 3) are cached read-only in SecureStore. They are encrypted and stored in ~1.8 KB chunks (`lib/storage.ts`, `lib/cache.ts`), and cleared on patient sign-out or session expiry.
- Online state is inferred from fetch results, because NetInfo is not installed. While offline the app probes `/health` every 15 s.
- An offline banner is shown on every screen, and buttons that change state (`ActionButton`) are disabled while offline.

## Push (FR-COM-7)

`lib/push.ts` requests notification permission after OTP sign-in and creates the Android channel. It reads the **native device token** (FCM/APNs, via `getDevicePushTokenAsync`), not an Expo push token, and posts it to `POST /v1/portal/devices` when it changes. Token rotation is handled with a listener. A tap on a notification whose `data.path` starts with `/` navigates there. Shared topics are never used.

Patient sign-out (`lib/session.tsx` `signOutPatient`) runs in this order: `POST /v1/portal/devices/unregister {token}` while the access token is still valid, then `POST /v1/auth/logout {refreshToken}`, which revokes only this device's refresh-token family (other devices stay signed in), then clears tokens and the offline cache. Both calls are best effort, so sign-out also works offline. Account deletion also unregisters the push token.

## Stubbed / not verified

- **Not run on a device or simulator.** Verified offline: `tsc --noEmit` (strict, `noUncheckedIndexedAccess`), `expo config --type public`, `expo export --platform android` (bundle OK), and `expo prebuild` in a scratch copy, which confirmed the generated network-security-config, pin-set, cleartext flags, FLAG_SECURE in `MainActivity.kt`, iOS `NSPinnedDomains`, associated domains, R8 gradle properties and localised `InfoPlist.strings`.
- Telemedicine, the AI scribe, complaints, signed PDF links and the new appointment/doctor endpoints were checked against the controller source only, not against a running API.
- **AI dictation audio** is not recorded in-app (no audio module installed); doctors type or use the keyboard's voice input. The API's `audio` upload path is unused.
- **Video calls** open the provider's URL in the system browser (expo-web-browser); there is no in-app video SDK, and the passcode cannot be copied to the clipboard (expo-clipboard is not installed), so it is shown as selectable text.
- Screenshot blocking per screen (needs expo-screen-capture) and root/jailbreak detection: see the security table.
- The live queue uses polling (doctor 20 s, reception 15 s, patient 30 s). The SSE `/v1/queue/stream` is not consumed, because RN fetch has no streaming body without extra polyfills.
- App icon, splash and fonts (LOC-3: IBM Plex Sans Arabic, self-hosted) are not added. No assets or expo-font setup exist yet.

## API gaps and mismatches noticed

Resolved in sprints 8–13 and now used by the app: single patient appointment (`GET /v1/portal/appointments/:id`), signed PDF links, `encounter_id` on appointment and queue rows, `GET /v1/appointments?ref=`, `GET /v1/doctors` for receptionists, per-device logout, `device_id` kept on refresh, device-token unregister, and the consent channel (now `app` when `x-client: app`).

Remaining:

1. **Payment return URL is site-only.** It is `${PUBLIC_SITE_URL}/book/result?ref=…` (`payments.ts` `createIntent`), and the app relies on a Universal/App Link on that domain. There is no app-specific `returnUrl`, even when `x-client: app`.
2. **Push payload has no deep-link convention** (the app assumes `data.path`). The messaging integration should include one for FR-APP-5 parity with SMS links.
3. **Portal appointment rows do not say whether a visit is a video consultation.** `portal.ts` `GET /v1/portal/appointments[/:id]` has no service type or `is_telemedicine`, so the app calls `GET /v1/portal/appointments/:id/telemedicine` for each shown appointment and treats 400 `not_a_video_consultation` as "in-clinic".
4. **Video visits cannot be booked in the app.** `public.ts` `GET /v1/public/doctors/:slug` and `GET /v1/public/services` exclude `type = 'telemedicine'`, so the booking wizard never offers them; video visits are booked by staff. The app still maps `telemedicine_requires_online_payment` (`appointments.service.ts` `book`).
5. **Doctor video list lacks `patient_id` and `encounter_id`.** `telemedicine.ts` `GET /v1/telemedicine` returns neither, so opening the encounter outside **Start** reads today's appointment row for `encounter_id`, and the patient comes from the encounter.
6. **Public doctor profile returns `photo_key`, not `photo_url`.** `public.ts` `doctor` spreads `doctorsQuery` (which selects `d.photo_key`) without mapping it, so an internal storage key is public and the app derives `/v1/public/doctors/:slug/photo` itself. The list endpoint also exposes `photo_key` next to `photo_url`. `next_available` is computed for the first 60 list rows only.
7. **No pending-draft lookup.** `ai.ts` has only `GET /v1/ai/drafts/:id`; if the doctor leaves the review screen before deciding, the app cannot find the draft again (it expires after 24 h). A `GET /v1/encounters/:id/ai/drafts?status=pending` would fix this. The dictation route uses `FileInterceptor('audio')`; the app sends JSON, which multer passes through, but this was not run against the API.
8. **Complaints are write-only for patients.** `events.ts` has `POST /v1/portal/complaints` only, so patients cannot see status or resolution. The portal has no "my clinics" endpoint, so the form lists all clinics from `GET /v1/public/clinics`.
9. **Expired sessions keep the push token.** When refresh fails (`auth.ts` `refresh`, family revoked or expired) the app can no longer call `devices/unregister`. The API should delete the account's device tokens for that device when it revokes a refresh family (needs `device_tokens.device_id`).
