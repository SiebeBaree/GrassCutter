import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the build works from any static host or subpath.
  base: './',
  // three.js is most of the bundle and doesn't split usefully.
  build: { chunkSizeWarningLimit: 800 },
})
