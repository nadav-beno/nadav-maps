import { defineConfig } from 'vite';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/nadav-maps/").
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // MapLibre is a large library; that's expected.
  build: { chunkSizeWarningLimit: 1500 },
});
