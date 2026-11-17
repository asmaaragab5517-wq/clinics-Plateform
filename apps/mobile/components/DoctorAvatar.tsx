import { useState } from 'react';
import { Image, View } from 'react-native';
import { T, colors } from './ui';
import { API_URL, ORG_SLUG } from '../lib/config';

/**
 * Public doctor photo (GET /v1/public/doctors/:slug/photo, not PHI, cached for a day by the API).
 * `path` is the relative API path from `photo_url`. Falls back to the initial when there is no photo or it fails.
 */
export function DoctorAvatar({ path, name, size = 48 }: { path: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2, marginEnd: 12, backgroundColor: colors.border, alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const };
  if (!path || failed || !path.startsWith('/')) {
    return (
      <View style={box} accessibilityElementsHidden importantForAccessibility="no">
        <T style={{ fontWeight: '700', color: colors.muted, fontSize: size / 2.4 }}>{name.trim().slice(0, 1)}</T>
      </View>
    );
  }
  return (
    <View style={box}>
      <Image
        source={{ uri: `${API_URL}${path}`, headers: { 'x-org': ORG_SLUG } }}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
    </View>
  );
}

/** photo_url from the list endpoint; the profile endpoint only carries photo_key, so derive the same public path. */
export const doctorPhotoPath = (d: { slug: string; photo_url?: string | null; photo_key?: string | null }) =>
  d.photo_url ?? (d.photo_key ? `/v1/public/doctors/${encodeURIComponent(d.slug)}/photo` : null);
