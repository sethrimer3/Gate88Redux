import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic unit tests only — none of these launch Steam, Electron or a browser.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
