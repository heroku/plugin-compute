# Changelog

All notable changes to `@heroku/plugin-compute` are documented here.

## [0.4.4](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.4.3...plugin-compute-v0.4.4) (2026-11-11)


### Bug Fixes

* leave no app directory behind when sf compute source retrieve fails ([#77](https://github.com/heroku/plugin-compute/issues/77)) ([cdefb40](https://github.com/heroku/plugin-compute/commit/cdefb4088067a427ec1cc05a2f17a752db5bd006))

## [0.4.3](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.4.2...plugin-compute-v0.4.3) (2026-11-06)


### Bug Fixes

* handle flat source.tar.gz response in sf compute source retrieve ([#75](https://github.com/heroku/plugin-compute/issues/75)) ([fb1b939](https://github.com/heroku/plugin-compute/commit/fb1b93952435a4b995af89bbd2203f9d84ae060a))

## [0.4.2](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.4.1...plugin-compute-v0.4.2) (2026-11-03)


### Features

* support runtime-log fetch and tail on Fir apps via log sessions ([#73](https://github.com/heroku/plugin-compute/issues/73)) ([8f5b5d4](https://github.com/heroku/plugin-compute/commit/8f5b5d452feb43244b97ccc34b23732b820bfbeb))

## [0.4.1](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.3.2...plugin-compute-v0.4.1) (2026-10-29)


### ⚠ BREAKING CHANGES

* use new ComputeApp metadata type ([#63](https://github.com/heroku/plugin-compute/issues/63))

### Features

* use new ComputeApp metadata type ([#63](https://github.com/heroku/plugin-compute/issues/63)) ([ad524a0](https://github.com/heroku/plugin-compute/commit/ad524a055b292cb89df9941641c933b54d238c2a))


### Dependencies

* bump ignore from 7.0.12 to 7.0.13 ([#59](https://github.com/heroku/plugin-compute/issues/59)) ([10ffceb](https://github.com/heroku/plugin-compute/commit/10ffceb8bcadb4a759cd9ca21eb013d08f6c1659))


### Miscellaneous Chores

* roll plugin-compute release track forward to 0.4.1 ([#67](https://github.com/heroku/plugin-compute/issues/67)) ([c3e15b0](https://github.com/heroku/plugin-compute/commit/c3e15b0e7fe70354ef26ebae8570f14f20125aa4))

## [0.3.2](https://github.com/heroku/plugin-compute/compare/plugin-compute-v0.3.1...plugin-compute-v0.3.2) (2026-10-27)


### Features

* add sf compute delete telemetry-drain command ([#48](https://github.com/heroku/plugin-compute/issues/48)) ([2049117](https://github.com/heroku/plugin-compute/commit/2049117486dbeddccfa816d30ddb90d16130c79a))
* removes `compute deploy` functionality, removes sensitive output from `--json`, other small tweaks @W-24389913@ ([#55](https://github.com/heroku/plugin-compute/issues/55)) ([984f399](https://github.com/heroku/plugin-compute/commit/984f399b6d3f0c757921e599ac514c7b944cb2e9))


### Bug Fixes

* stop Ctrl-C trace on tail runtime-log and never hang get runtime-log ([#54](https://github.com/heroku/plugin-compute/issues/54)) ([81c15b4](https://github.com/heroku/plugin-compute/commit/81c15b49d2e1fc923bc928633318de9ee3d1c959))


### Dependencies

* bump fast-uri from 3.1.8 to 3.1.9 ([#61](https://github.com/heroku/plugin-compute/issues/61)) ([f3bb684](https://github.com/heroku/plugin-compute/commit/f3bb6848963efeb1f53bdd94113724e3df4fd837))
* bump ip-address from 10.7.3 to 10.7.4 ([#52](https://github.com/heroku/plugin-compute/issues/52)) ([2f27cf4](https://github.com/heroku/plugin-compute/commit/2f27cf47fb66cdeed4ba7ed2c1ed7b62be514bf8))
* bump undici from 8.11.2 to 8.12.3 ([#62](https://github.com/heroku/plugin-compute/issues/62)) ([43bedfa](https://github.com/heroku/plugin-compute/commit/43bedfa2873f9aceb39b4127d1d9eb850917a6e5))
* bump zod from 4.6.5 to 4.6.7 ([#57](https://github.com/heroku/plugin-compute/issues/57)) ([9469dea](https://github.com/heroku/plugin-compute/commit/9469deaab0918fbd1c03501dcd0d9b97122bbb79))

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
