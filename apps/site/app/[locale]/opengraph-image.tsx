import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'HealthFlow Clinics';

/** Default Open Graph image (FR-WEB-4). Latin wordmark only, so no font files are fetched. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0f766e', color: 'white' }}>
        <div style={{ fontSize: 96, fontWeight: 700 }}>HealthFlow</div>
        <div style={{ fontSize: 48, opacity: 0.9 }}>Clinics</div>
        <div style={{ marginTop: 40, width: 160, height: 8, borderRadius: 4, background: '#0284c7' }} />
      </div>
    ),
    size,
  );
}
