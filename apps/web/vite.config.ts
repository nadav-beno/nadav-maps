import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/nadav-maps/").
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact()],
  build: {
    // MapLibre alone is ~800 KB; it gets its own chunk so app updates don't re-download it.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'maplibre';
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: { host: true },
});
