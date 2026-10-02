import herokuEslintConfig from '@heroku-cli/test-utils/eslint-config';
import vitestOverlay from '@heroku-cli/test-utils/eslint-config/vitest';

export default [
  { ignores: ['src/generated/**', 'lib/**'] },
  ...herokuEslintConfig,
  ...vitestOverlay,
  {
    // These eslint-config-oclif rules clash with mandatory @salesforce/sf-plugins-core patterns:
    //   - no-top-level-side-effects: commands call importMessagesDirectoryFromMetaUrl() at module scope.
    //   - class-literal-property-style: oclif command metadata must be `static readonly`, not getters.
    //   - prefer-https: its autofix would rewrite the http:// Apache license URL in every header.
    rules: {
      'unicorn/no-top-level-side-effects': 'off',
      '@typescript-eslint/class-literal-property-style': 'off',
      'unicorn/prefer-https': 'off',
    },
  },
  {
    // Intentionally off: style opinions that conflict with this codebase's conventions.
    rules: {
      // null is a meaningful wire value (Heroku/Connect APIs return it; it's what unsets a config
      // var), so the autofix collapsing it to undefined is a correctness bug.
      'unicorn/no-null': 'off',
      // Key order is runtime-observable -- FETCHED_FILES's missing-file order and the scaffolded
      // package.json's key order -- so the autofix is unsafe. Type/union member sorts stay on.
      'perfectionist/sort-objects': 'off',
      // Buffer is a legitimate Node global and type here.
      'n/prefer-global/buffer': 'off',
      '@typescript-eslint/no-restricted-types': 'off',
      // Named imports from node builtins read better than the forced default-import style.
      'unicorn/import-style': 'off',
      // Shared modules use camelCase (computeApp.ts); kebab-case would churn every import.
      'unicorn/filename-case': 'off',
      // Conflicts with perfectionist/sort-classes (also on), which orders public methods before
      // private -- the opposite of this rule's default. The codebase follows sort-classes.
      'unicorn/consistent-class-member-order': 'off',
    },
  },
  {
    // Warn, not error: flags ReadableStream (core to src/shared/computeLogStream.ts) as
    // experimental below Node 22.15.0 vs. engines >=22.0.0. It can't be refactored away and we
    // won't raise the install floor for it, so keep it a non-blocking signal.
    rules: {
      'n/no-unsupported-features/node-builtins': 'warn',
    },
  },
];
