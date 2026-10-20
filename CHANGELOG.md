# Changelog

All notable changes to `@heroku/plugin-compute` are documented here.

## [0.3.1](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.3.0...plugin-compute-v0.3.1) (2026-10-20)


### Features

* add sf compute create and update telemetry-drain commands ([#46](https://github.com/heroku/plugin-compute/issues/46)) ([109d123](https://github.com/heroku/plugin-compute/commit/109d123b7f388b3f050105dd6d1d7aef3843b965))
* deprecate sf compute generate in favor of template generate project ([#44](https://github.com/heroku/plugin-compute/issues/44)) ([7550ebf](https://github.com/heroku/plugin-compute/commit/7550ebf6dae4f15d526b2445fa6253f06a6308e4))


### Bug Fixes

* send a Range header Heroku accepts when fetching the latest release ([#47](https://github.com/heroku/plugin-compute/issues/47)) ([a6e4f26](https://github.com/heroku/plugin-compute/commit/a6e4f26c1d7287f1e9b003e4ef0925bdc7cb4c73))

## [0.3.0](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.2.0...plugin-compute-v0.3.0) (2026-10-16)


### ⚠ BREAKING CHANGES

* migrate sf compute config commands to verb-noun grammar ([#38](https://github.com/heroku/plugin-compute/issues/38))
* `compute scale` no longer accepts positional type[=count][:size] targets or scaling multiple process types in one invocation. Use --process-type with --quantity and/or --size; run the command once per process type.
* split compute logs into get and tail runtime-log ([#26](https://github.com/heroku/plugin-compute/issues/26))
* **compute:** rename compute build output to compute get build-log ([#24](https://github.com/heroku/plugin-compute/issues/24))
* `sf compute config` no longer lists config vars; use `sf compute config list` instead.

### Features

* add sf compute list telemetry-drain and display telemetry-drain commands ([#37](https://github.com/heroku/plugin-compute/issues/37)) ([d48482c](https://github.com/heroku/plugin-compute/commit/d48482c5e3a063dc6d685f05c13286651637577f))
* add telemetry-drain Platform API integration and command scaffolding ([#35](https://github.com/heroku/plugin-compute/issues/35)) ([58ab117](https://github.com/heroku/plugin-compute/commit/58ab117d0b32bd78ab42846d49f667f4ad7f9623))
* **compute:** rename compute build output to compute get build-log ([#24](https://github.com/heroku/plugin-compute/issues/24)) ([010274b](https://github.com/heroku/plugin-compute/commit/010274be7480011b944cd56a5e869a82621b6b55))
* migrate sf compute config commands to verb-noun grammar ([#38](https://github.com/heroku/plugin-compute/issues/38)) ([af30791](https://github.com/heroku/plugin-compute/commit/af307911da82b7f2d436673970b98e4e05d81c24))
* move `compute config` listing to `compute config list` ([#21](https://github.com/heroku/plugin-compute/issues/21)) ([a18e2c6](https://github.com/heroku/plugin-compute/commit/a18e2c6b0734542fb88090d256ff058b2abffd5c))
* replace compute scale positional arg with flags ([#27](https://github.com/heroku/plugin-compute/issues/27)) ([65743d3](https://github.com/heroku/plugin-compute/commit/65743d39e2b4fe9e3ef332afbf7fb9ee987c261d))
* split compute logs into get and tail runtime-log ([#26](https://github.com/heroku/plugin-compute/issues/26)) ([d38f8f4](https://github.com/heroku/plugin-compute/commit/d38f8f45ad2f02dd3957033c4bf10ce2508b79a2))


### Bug Fixes

* fetch Heroku app metadata for sf compute display table ([#28](https://github.com/heroku/plugin-compute/issues/28)) ([3a0410f](https://github.com/heroku/plugin-compute/commit/3a0410f0a3dbddc00bfcef80ac9a1d63269ef933))
* migrate Heroku API proxy calls to /connect/compute/proxy ([#34](https://github.com/heroku/plugin-compute/issues/34)) ([a54aa1c](https://github.com/heroku/plugin-compute/commit/a54aa1c66886aed0ddabef4df89259e12f80cd6b))
* stop stripping deploy-bundle files and generate-template files ([#17](https://github.com/heroku/plugin-compute/issues/17)) ([b918e14](https://github.com/heroku/plugin-compute/commit/b918e141b7c782bec3321e0b303520f36a87e8bb))


### Dependencies

* bump @salesforce/kit from 3.2.6 to 4.0.1 ([#32](https://github.com/heroku/plugin-compute/issues/32)) ([1398735](https://github.com/heroku/plugin-compute/commit/139873536f5ea281a85634e6f38000e34cf28f6a))


### Miscellaneous Chores

* force 0.3.0 release ([#39](https://github.com/heroku/plugin-compute/issues/39)) ([6a4158b](https://github.com/heroku/plugin-compute/commit/6a4158b1012689737dfa552680b091558bd45017))

## [0.1.0](https://github.com/heroku/plugin-compute/compare/56a7283...eea44cd) (2026-09-03)

### Features

- initial `sf compute generate`, `deploy`, and `display` commands ([56a7283](https://github.com/heroku/plugin-compute/commit/56a7283fc7f474f116a56d3b9e1174f8fe595f9b))
- add `sf compute list`, `build output`, and `logs` commands ([eea44cd](https://github.com/heroku/plugin-compute/commit/eea44cd99aa2f9bbd4f84f871f612f2241acce78))

### Chores

- regenerate command snapshot and JSON schemas ([b81d1e5](https://github.com/heroku/plugin-compute/commit/b81d1e5789ef34ff188a184eeff22366fc139e1c))
