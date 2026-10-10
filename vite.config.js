import { defineConfig } from 'vite';

// SHAI — Vite configuration
// Base is relative so the exact same `dist/` works from:
//   * the dev server / any static host  (https://host/…)
//   * the Android WebView inside the Capacitor APK (file://android_asset/public/…)
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Don't watch the native project / build output — it's huge and never feeds the web app.
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/.smoke/**', '**/node_modules/**'],
    },
    // Allow the sandboxed preview host (https://5173-<id>.e2b.app) to reach the dev server.
    allowedHosts: true,
    hmr: process.env.HTTPS_HMR ? { protocol: 'wss', clientPort: 443 } : true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019',
    assetsInlineLimit: 0, // keep fonts as real files so the SW/APK can ship them
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['@capacitor/core', '@capacitor/preferences', '@capacitor/browser'],
        },
      },
    },
  },
});
