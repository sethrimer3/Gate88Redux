import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // No file-size constraint — this port prioritises fidelity over bundle size.
    chunkSizeWarningLimit: 100_000,
  },
  publicDir: 'public',
});
