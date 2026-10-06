import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Isolate the @salesforce/core state dir (~/.sf) per test file so parallel
    // test files don't race on a shared alias.json (see the setup file).
    setupFiles: ['./test/setup/sf-home-isolation.ts'],
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
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
