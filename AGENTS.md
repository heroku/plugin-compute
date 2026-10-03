# AGENTS.md — plugin-compute

`@salesforce/plugin-compute` is a Salesforce CLI (`sf`) plugin, built on the
oclif plugin framework and `@salesforce/sf-plugins-core`, that adds
`sf compute deploy|display|generate|list|logs|build output|scale|config|config
get|config set|config unset` — commands for managing "compute apps"
(Heroku-backed `PlatformComputeApp` metadata invocable from Apex/Flow via
AppLink External Services).

Standard oclif/sf-plugins-core layout: commands in `src/commands/compute/`,
shared logic in `src/shared/`, user-facing strings in `messages/*.md`
(one file per command, keyed by section headers), tests mirror `src/` under
`test/`. Generated OpenAPI types live in `src/generated/` (see
`generate:types` script — regenerate via
`openapi-typescript api-specs/*.yaml -o src/generated/...`, do not hand-edit).

## Repo-wide standing rule

**Do not commit or push anything in this repo without an explicit user ask.**
This overrides the global git-workflow defaults — treat every session as
write-file-only unless told otherwise.

For every `sf compute` command — deploy/display/generate/list and every
command added since (logs/build output/scale/config/config get/config
set/config unset) — consult an Architect-role and QA-role review both
BEFORE and AFTER implementing changes.

## Gotcha: `SfCommand.table()` styling is a no-op — don't chase it

If a bug report says a `list`/`display` table's border or header casing
"looks wrong," it is not a bug in this plugin — it's structural in
`@salesforce/sf-plugins-core`. In `lib/ux/ux.js`, `Ux.table(options)` calls
`printTable({...options, ...getDefaults(options)})` — `getDefaults()` is
spread LAST and unconditionally returns its own `borderStyle` (default
`'vertical-with-outline'`, box-drawn with corners) and
`headerOptions.formatter` (hardcoded `'capitalCase'`). Any `borderStyle` or
`headerOptions` passed from command code into `this.table({...})` is
silently discarded. The border style is only overridable by the _end user_
via the `SF_TABLE_BORDER_STYLE` env var — never by command code. Confirmed by
rendering a table with those options set and observing them ignored. Don't
"fix" this in `src/commands/compute/list.ts` or `display.ts` — there's
nothing to fix at this layer.

## Design decisions already made (don't re-litigate without new user input)

- **`sf compute deploy` has no `--name` flag.** It derives the app name from
  `basename()` of the target directory — by default the cwd, or the
  directory passed via `--source-dir` (default: `process.cwd()`, char `-d`).
  Either way it must resolve to the compute app's own directory (the one
  `sf compute generate` created). It validates by checking
  `<name>.compute-meta.xml` exists in that directory
  (`src/commands/compute/deploy.ts`, error key `error.notAppDir` in
  `messages/compute.deploy.md`). **This check runs BEFORE `validateName(name)`
  intentionally** — resolving to the wrong directory must produce "cd into
  the app's directory" guidance, not a confusing "name isn't valid" error.
  Do not swap that ordering back. `--source-dir` is deploy's own mechanism
  for pointing at an app directory from anywhere — it is not the same as the
  `--name`/`COMPUTE_APP_NAME`/directory-detection fallback chain used by
  display/logs/build output/scale/config/config get/config set/config unset.
- **`sf compute list` has no `--verbose` flag** and always shows exactly 4
  columns (`name`, `masterLabel`, `status`, `statusReason`). Explicit user
  decision: "if the customer wants more details, they should use the display
  command." `sf compute display --name <app>` is the place for full
  single-app detail (description, external service registration, current
  build). Don't re-add `--verbose` to `list` without a fresh explicit ask.
- The original four commands (deploy/display/generate/list) were audited
  against the full Salesforce CLI Plugin Developer Guide
  (design-guidelines, conceptual-overview, patterns, flags, actions,
  common-actions, resources, topics, messages, interactivity, sub-actions).
  They match the canonical standard verbs in `common-actions.html`
  (list = simple table, display = full detail, deploy = push local source,
  generate = scaffold). None of the four need interactive prompts or
  sub-actions today. logs/build output/scale/config/config
  get/config set/config unset were added in a later session — re-audit
  before assuming the same guide compliance for those.

## Environment quirk: `NODE_ENV=development` breaks oclif tooling

This environment has `NODE_ENV=development` set persistently in the shell.
It breaks oclif's `Config` module resolution during `npm run version`
(`oclif readme`) and can silently wipe the README.md `<!-- commands -->`
section, and can also affect `./bin/dev.js snapshot generate` /
`./bin/dev.js schema generate`. Always prefix these:

```bash
env -u NODE_ENV npm run version
env -u NODE_ENV ./bin/dev.js snapshot generate
env -u NODE_ENV ./bin/dev.js schema generate
```

Both generators emit their own formatted JSON, so no post-formatting step is
needed (this repo has no prettier — the test runner is vitest and lint is the
`@heroku-cli/test-utils` eslint-config).

## Environment quirk: `min-release-age` blocks lockfile regeneration

This repo is npm-based (not yarn): `package-lock.json` is committed and CI runs
`npm ci`. There is **no `.npmrc`** — the earlier yarn→npm peer-dep skew only
needed `legacy-peer-deps` because of a hard `@typescript-eslint/parser` conflict,
which is now fixed by pinning that parser as a direct devDep. The only remaining
skew is a harmless `peerOptional typescript@>=6` from `eslint-config-xo`, which
npm resolves with a warning.

A dev `~/.npmrc` in this environment sets `min-release-age=3` (npm 11's
supply-chain guard, hiding versions published in the last 3 days). A **cold**
`npm install` (empty `node_modules` + no lockfile) then fails `ETARGET` on
pinned pre-releases like `@heroku-cli/test-utils@2.0.0-beta.0`. `npm ci` from a
complete committed lockfile is unaffected (it uses pinned tarball URLs). To
regenerate the lockfile from scratch, override the guard for that one command:

```bash
rm -rf node_modules package-lock.json
env -u NODE_ENV npm_config_min_release_age=0 npm install
```

A cold regen also re-resolves `^` ranges and can float third-party `@types`
(e.g. `@types/sinon` vs a newer `@sinonjs/fake-timers`); both `tsconfig.json` and
`test/tsconfig.json` set `skipLibCheck: true` so upstream `.d.ts` drift we don't
own can't break `tsc`.

## Verification workflow after changing any command's flags or output shape

1. `npx tsc -p .` and `npx tsc -p ./test`
2. `npm run lint`
3. `npx vitest run` (unit tests; add `--coverage` to mirror CI)
4. `env -u NODE_ENV npm run build && env -u NODE_ENV npm test` — `npm test` is a
   flat `&&` chain of `test:compile`, `test:only`, `test:command-reference`,
   `test:deprecation-policy`, `test:json-schema`, `link-check`. Lint is NOT in
   this chain — it runs as its own `npm run lint` (step 2 above) and as a
   dedicated `lint` job in CI. `test:deprecation-policy` validates
   `command-snapshot.json` against actual flags; `test:json-schema` validates
   `schemas/*.json` against actual output shapes — both fail on stale artifacts.
5. If step 4 flags drift, regenerate per the section above, then re-run step
   4 to confirm green.
6. `env -u NODE_ENV npm run version` to regenerate README.md's
   `<!-- commands -->` section.

`test:nuts` (`**/*.nut.ts`, e.g. `test/commands/compute/generate.nut.ts`) are
integration tests run separately via `npm run test:nuts` — not part of the
default `npm test` chain.
