# Changelog

All notable changes to `@heroku/plugin-compute` are documented here.

## [0.2.0](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.1.0...plugin-compute-v0.2.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* `sf compute config` no longer lists config vars; use `sf compute config list` instead.

### Features

* move `compute config` listing to `compute config list` ([#21](https://github.com/heroku/plugin-compute/issues/21)) ([a18e2c6](https://github.com/heroku/plugin-compute/commit/a18e2c6b0734542fb88090d256ff058b2abffd5c))


### Bug Fixes

* stop stripping deploy-bundle files and generate-template files ([#17](https://github.com/heroku/plugin-compute/issues/17)) ([b918e14](https://github.com/heroku/plugin-compute/commit/b918e141b7c782bec3321e0b303520f36a87e8bb))

## [0.1.0](https://github.com/heroku/plugin-compute/compare/56a7283...eea44cd) (2026-09-03)

### Features

- initial `sf compute generate`, `deploy`, and `display` commands ([56a7283](https://github.com/heroku/plugin-compute/commit/56a7283fc7f474f116a56d3b9e1174f8fe595f9b))
- add `sf compute list`, `build output`, and `logs` commands ([eea44cd](https://github.com/heroku/plugin-compute/commit/eea44cd99aa2f9bbd4f84f871f612f2241acce78))

### Chores

- regenerate command snapshot and JSON schemas ([b81d1e5](https://github.com/heroku/plugin-compute/commit/b81d1e5789ef34ff188a184eeff22366fc139e1c))
