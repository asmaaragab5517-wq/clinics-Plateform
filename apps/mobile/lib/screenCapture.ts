import { useEffect } from 'react';

/**
 * FR-APP-4 / SEC-10: screenshot blocking on clinical screens.
 *
 * Per-screen blocking needs expo-screen-capture (preventScreenCaptureAsync / allowScreenCaptureAsync), which is
 * NOT installed in this workspace. What IS implemented: plugins/withSecurityHardening.js sets Android
 * FLAG_SECURE on the whole activity when HF_FLAG_SECURE=1 (preview/production profiles), which covers every
 * clinical screen (and the recents thumbnail). iOS has no screenshot-blocking API; expo-screen-capture can only
 * detect screenshots there.
 *
 * TODO(SEC-10): add expo-screen-capture, then implement this hook as:
 *   useEffect(() => { void preventScreenCaptureAsync(tag); return () => void allowScreenCaptureAsync(tag); }, [tag]);
 * and set HF_FLAG_SECURE=0 so non-clinical screens can be captured again.
 */
export function useClinicalScreen(tag: string) {
  useEffect(() => {
    // Intentionally a no-op until expo-screen-capture is available (see above).
    return undefined;
  }, [tag]);
}
