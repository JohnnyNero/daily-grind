import { defineConfig } from 'vite';

// The café game, kept to one side while the landlord game is built. It builds into
// dist/cafe, so it stays playable at /cafe/ on the site.
export default defineConfig({
  base: './',
  build: { outDir: '../dist/cafe', emptyOutDir: true },
});
