import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Мастерская — управление магазином',
        short_name: 'Мастерская',
        description: 'Конструктор интернет-магазинов и рабочее место владельца',
        theme_color: '#1f493d',
        background_color: '#f7f7f3',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/health': 'http://localhost:4000' },
  },
});
