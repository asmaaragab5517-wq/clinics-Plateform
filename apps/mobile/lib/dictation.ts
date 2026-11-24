import { Platform } from 'react-native';
import { RecordingPresets, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';

export type DictationLanguage = 'auto' | 'ar' | 'en';

/** API limit for the multipart `audio` part (ai.ts MAX_AUDIO_BYTES). */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** Recording cap: at 64 kbit/s mono, 15 minutes is ~7 MB, well inside the API limit. */
export const MAX_RECORDING_MS = 15 * 60 * 1000;
/** Shorter clips are discarded (an accidental tap). */
export const MIN_RECORDING_MS = 1500;

/**
 * expo-audio's HIGH_QUALITY preset (AAC in an .m4a/MPEG-4 container on Android and iOS, webm on web), reduced to
 * mono 64 kbit/s, which is plenty for speech. The API sniffs the container from its magic bytes (`ftyp` → audio/mp4).
 */
export const DICTATION_RECORDING: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 };

const TYPES: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg' };

/** Recording time as M:SS / H:MM:SS (Western digits, LTR-isolated by the caller). */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * multipart body for POST /v1/encounters/:id/ai/dictation: `language` plus the recorded file as `audio`.
 * On native, React Native's FormData streams the file from its `file://` URI; on web the recorder yields a blob URL.
 */
export async function dictationForm(uri: string, language: DictationLanguage): Promise<FormData> {
  const ext = (/\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(uri)?.[1] ?? (Platform.OS === 'web' ? 'webm' : 'm4a')).toLowerCase();
  const type = TYPES[ext] ?? 'audio/mp4';
  const name = `dictation.${TYPES[ext] ? ext : 'm4a'}`;
  const form = new FormData();
  form.append('language', language);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('audio', blob, name);
  } else {
    // React Native's FormData file part: { uri, name, type }.
    form.append('audio', { uri, name, type } as unknown as Blob);
  }
  return form;
}

/**
 * Deletes a recording from the app's private cache once it is uploaded, discarded or abandoned, so patient audio does
 * not stay on the phone. Best effort: a file that is already gone, or the web build, is ignored.
 */
export function discardRecording(uri: string | null | undefined) {
  if (!uri || Platform.OS === 'web') return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already removed */
  }
}
