import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Scope to the command/shared surface the tests exercise. src/index.ts is
      // the oclif barrel (never imported by a test) and src/generated/** is
      // generated OpenAPI types — excluding both keeps the threshold meaningful.
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts', 'src/generated/**', 'src/index.ts'],
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 50,
        branches: 50,
      },
    },
  },
});
