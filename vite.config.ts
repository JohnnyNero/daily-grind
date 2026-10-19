import { defineConfig } from 'vitest/config';

// Relative base so the built game works from any folder or static host.
// The café game lives in cafe/ with its own config and tests.
export default defineConfig({
  base: './',
  test: { include: ['test/**/*.test.ts'] },
});
