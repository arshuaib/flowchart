import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative assets let the built offline app open directly from dist/index.html.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Salary Reset',
        short_name: 'Salary Reset',
        description: 'A private, offline-first financial recovery coach.',
        theme_color: '#f6f7f2',
        background_color: '#f6f7f2',
        display: 'standalone',
        start_url: './',
        icons: [{ src: './favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallback: './index.html', globPatterns: ['**/*.{js,css,html,svg,png,ico}'] },
    }),
  ],
  optimizeDeps: {
    // Keep browser dev prebundling bounded; the remaining libraries are native ESM and can be loaded on demand.
    noDiscovery: true,
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
  },
  test: { environment: 'jsdom', setupFiles: './src/tests/setup.ts' },
});
