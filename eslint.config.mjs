import herokuEslintConfig from '@heroku-cli/test-utils/eslint-config';
import vitestOverlay from '@heroku-cli/test-utils/eslint-config/vitest';

export default [
  { ignores: ['src/generated/**', 'lib/**'] },
  ...herokuEslintConfig,
  ...vitestOverlay,
  {
    // eslint-config-oclif targets raw oclif plugins; these rules conflict with
    // mandatory @salesforce/sf-plugins-core patterns this plugin is built on:
    //   - no-top-level-side-effects: every command calls
    //     Messages.importMessagesDirectoryFromMetaUrl() at module scope.
    //   - class-literal-property-style: oclif requires `static readonly`
    //     command metadata (description/flags/...), not getters.
    //   - prefer-https: its autofix rewrites the canonical http:// Apache
    //     license URL in each file's header comment (and any intentional http
    //     reference), which would churn every license header.
    rules: {
      'unicorn/no-top-level-side-effects': 'off',
      '@typescript-eslint/class-literal-property-style': 'off',
      'unicorn/prefer-https': 'off',
    },
  },
  {
    // Intentionally off: these eslint-config-oclif rules encode style opinions
    // that conflict with this codebase's established conventions. Not planned
    // for adoption.
    rules: {
      // null is semantically meaningful here: the Heroku/Connect APIs return
      // null as a wire value (distinct from an absent field), and a null config
      // var is what unsets it. Collapsing null into undefined is a correctness
      // bug, so this rule must stay off (its autofix is actively unsafe here).
      'unicorn/no-null': 'off',
      // Object key order is runtime-observable here, so its autofix is unsafe:
      // FETCHED_FILES drives which missing file the "starter source is missing"
      // error reports first, and transformNodePackageJson's object literal is
      // the exact key order written to the scaffolded app's package.json.
      // Reordering keys silently changes both. (Type/union member sorts stay on
      // -- those are purely declaration-order and have no runtime effect.)
      'perfectionist/sort-objects': 'off',
      // Buffer is a legitimate Node global and a legitimate type here.
      'n/prefer-global/buffer': 'off',
      '@typescript-eslint/no-restricted-types': 'off',
      // Named imports from node builtins (e.g. `import { join } from 'node:path'`)
      // are clearer than the forced default-import style.
      'unicorn/import-style': 'off',
      // Shared modules use camelCase filenames (computeApp.ts); renaming the
      // whole tree to kebab-case would churn every import and blame history.
      'unicorn/filename-case': 'off',
    },
  },
  {
    // Deferred: real rules worth adopting, but the fixes are source-logic
    // changes out of scope for the test-runner/ESLint tooling migration.
    // Tracked for incremental burn-down (see follow-up WI); re-enable per rule.
    rules: {
      'require-unicode-regexp': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/strict-void-return': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      '@eslint-community/eslint-comments/require-description': 'off',
      'import-x/no-anonymous-default-export': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/no-return-array-push': 'off',
      'unicorn/no-unsafe-string-replacement': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-error-property-assignment': 'off',
      'unicorn/consistent-class-member-order': 'off',
      'unicorn/no-computed-property-existence-check': 'off',
      'unicorn/no-non-function-verb-prefix': 'off',
      'unicorn/max-nested-calls': 'off',
    },
  },
];
