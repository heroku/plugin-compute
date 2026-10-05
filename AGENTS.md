# AGENTS.md — plugin-compute

`@heroku/plugin-compute` is a Salesforce CLI (`sf`) plugin, built on the
oclif plugin framework and `@salesforce/sf-plugins-core`, that adds
`sf compute deploy|display|generate|list|logs|build output|scale|config|config
get|config set|config unset` — commands for managing "compute apps"
(Heroku-backed `PlatformComputeApp` metadata invocable from Apex/Flow via
AppLink External Services).

## Package name: `@heroku/plugin-compute` (temporary — will become `@salesforce/`)

The npm package name is **`@heroku/plugin-compute`**. This is deliberate and
temporary: while the plugin is private/pre-GA it publishes under the `@heroku`
scope. **Once it goes public, the name switches to `@salesforce/plugin-compute`.**
The CLI binary (`sf`) and the `sf compute …` command surface are unaffected —
only the npm identifier changes. The package name is load-bearing beyond
`package.json`: every `Messages.loadMessages(PLUGIN_NAME, …)` call in `src/`
must match it (or message loading throws at runtime), and
`command-snapshot.json`'s `plugin` field must match it (or `snapshot:compare`
fails). The `loadMessages` first arg is centralized in one place — the
`PLUGIN_NAME` const in `src/shared/plugin-name.ts` — so the message-bundle key
is a single edit, not a `src/`-wide sweep. When the eventual `@salesforce/`
rename happens, update all three in lockstep (`package.json` +
`package-lock.json` name, the `PLUGIN_NAME` const in
`src/shared/plugin-name.ts`, and the snapshot `plugin` field) plus the
README/CHANGELOG/CONTRIBUTING references.

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

If an `npm config` `min-release-age` guard is active (npm 11's supply-chain
feature, hiding versions published in the last N days), a **cold** `npm install`
(empty `node_modules` + no lockfile) can fail `ETARGET` on pinned pre-releases
like `@heroku-cli/test-utils@2.0.0-beta.0`. `npm ci` from a complete committed
lockfile is unaffected (it uses pinned tarball URLs). To regenerate the lockfile
from scratch when the guard is in effect, override it for that one command:

```bash
rm -rf node_modules package-lock.json
env -u NODE_ENV npm_config_min_release_age=0 npm install
```

A cold regen also re-resolves `^` ranges and can float third-party `@types` out
of step with the packages they describe (currently `@salesforce/core`'s `.d.ts`
references `pino.TransportSingleOptions`, which the resolved `pino` types no
longer export); both `tsconfig.json` and `test/tsconfig.json` set
`skipLibCheck: true` so upstream `.d.ts` drift we don't own can't break `tsc`.

## Test stack: vitest only — but `@types/sinon` stays (don't remove it)

Tests use vitest's built-in `vi` + global `expect`. The `sinon` and `chai`
**libraries** (and `@types/chai`) are intentionally NOT direct deps — no test
file imports them. Our own test doubles are `vi.fn()` / `vi.spyOn()`, and
assertions use the global vitest `expect`.

**But `@types/sinon` is a required devDep even though nothing imports `sinon`.**
`@salesforce/core`'s `TestContext` (`$$.SANDBOX.stub(...).returns(...)`,
`$$.fakeConnectionRequest`) and `@salesforce/sf-plugins-core`'s
`stubSfCommandUx` / `stubSpinner` return sinon-typed stubs, and the tests read
`.getCalls()` / `.firstCall` / `.lastCall` / `.returns` / `.stub` on them. Those
framework packages carry `@types/sinon` only as a *devDep*, so it isn't resolved
transitively for consumers — without our own direct `@types/sinon` the stub
types collapse to `any`. Plain `any` reads don't error under `tsc` on their own
(this is just how an unresolved type degrades — not something `skipLibCheck`
buys us; `noImplicitAny` only fires on un-annotated *declaration* positions,
which these stub property reads aren't), but the type-aware
`@typescript-eslint/no-unsafe-*` rules reject them across the whole suite
(70+ errors on every `.getCalls`/`.firstCall`/`.returns`/`.stub` access). It is
type-only (no runtime, no supply-chain surface), so keeping it is the correct
posture. We pin `^10` even though the transitively-present `sinon` runtime is
v17: `@salesforce/core` itself builds against `@types/sinon@^10`, so v10 matches
the stub shapes the framework exposes, and the runtime major is irrelevant to
type-only consumption — the version skew is harmless, not a hazard. The vitest `expect` matchers (`toHaveBeenCalledWith`, …) only work on
`vi.fn()` mocks — never on these framework sinon stubs; wrap sinon-stub property
reads in `expect(...)` instead (e.g. `expect(stub.firstCall.args[0]).to…`).

## Temporarily removed: `@salesforce/plugin-command-reference` (re-enable when upstream is clean)

The `test:command-reference` gate (`sf commandreference generate
--error-on-warnings`, which lint-checks every command's flags/args/examples
docs) and its backing devDependency `@salesforce/plugin-command-reference`
were **removed** — dropped from `devDependencies`, from `oclif.devPlugins`, from
the `test` `&&` chain, and the `test:command-reference` script deleted. It was a
dev-only doc-correctness check; it never shipped (`files[]` excludes
`node_modules`) and does not affect runtime.

**Why:** that single devDep owned ~47 of ~53 lockfile vulnerability alerts — its
nested tree bundles stale `nyc`/`istanbul-lib-processinfo`/`uuid`/`gaxios`/`yaml`.
It was already pinned at the latest published version, whose tree still carried
those advisories, so there was no bump that cleared them.

**Re-enable when** a `@salesforce/plugin-command-reference` release ships without
those transitive advisories (check `npm audit` after adding it back). To restore:
re-add the devDep, add `@salesforce/plugin-command-reference` back to
`oclif.devPlugins`, restore the `test:command-reference` script
(`node --loader ts-node/esm --no-warnings=ExperimentalWarning ./bin/dev.js
commandreference:generate --error-on-warnings`), splice it back into the `test`
chain between `test:only` and `test:deprecation-policy`, re-add it to the CI
comment in `.github/workflows/ci.yml`, and regenerate the lockfile.

## Verification workflow after changing any command's flags or output shape

1. `npx tsc -p .` and `npx tsc -p ./test`
2. `npm run lint`
3. `npx vitest run` (unit tests; add `--coverage` to mirror CI)
4. `env -u NODE_ENV npm run build && env -u NODE_ENV npm test` — `npm test` is a
   flat `&&` chain of `test:compile`, `test:only`,
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
