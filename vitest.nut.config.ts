import { defineConfig } from 'vitest/config';

// NUTs (not-unit-tests) shell out via @salesforce/cli-plugins-testkit and are
// run separately from the default `test` chain. No coverage; long timeouts
// because each test spins up a real scratch project and runs the CLI.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.nut.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
