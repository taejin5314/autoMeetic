import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'better-sqlite3': path.resolve('./src/test/__sqlite-shim__.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: ['src/**/*.test.ts', 'src/renderer/**', 'src/preload/**', 'src/**/*.d.ts'],
    },
  },
});
