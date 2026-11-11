import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Framework glue (pages, islands, middleware) is exercised via T09's
      // integration pass; unit coverage targets the framework-agnostic core.
      include: ['src/lib/**/*.ts', 'src/db/**/*.ts', 'src/jobs/**/*.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
