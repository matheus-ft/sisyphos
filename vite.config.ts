import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves from /<repo>/, so the CI build passes --base. Locally
  // the app sits at the root, which is also what an installed PWA expects.
  base: command === 'build' ? undefined : '/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precaching the whole bundle is what makes the app launch with no signal.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'Sisyphos',
        short_name: 'Sisyphos',
        description: 'Powerlifting training log and analysis',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'portrait',
        // Relative, so the same build works at the root or under /<repo>/.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: { alias: { $lib: '/src/lib' } },
}));
