import type { MetadataRoute } from 'next';
import { translate } from '@/lib/i18n';

/** NFR-7 installable console: Arabic-first, right-to-left, opens on the role landing page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: translate('ar', 'app.name'),
    short_name: translate('ar', 'pwa.shortName'),
    description: translate('ar', 'shell.title'),
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f8fafa',
    theme_color: '#0f766e',
    categories: ['medical', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
