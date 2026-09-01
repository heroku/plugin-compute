# plugin-compute

[![NPM](https://img.shields.io/npm/v/@salesforce/plugin-compute.svg?label=@salesforce/plugin-compute)](https://www.npmjs.com/package/@salesforce/plugin-compute) [![Downloads/week](https://img.shields.io/npm/dw/@salesforce/plugin-compute.svg)](https://npmjs.org/package/@salesforce/plugin-compute) [![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/license/apache-2-0)

`sf compute` -- the CLI for Salesforce Compute: generate, deploy, and operate
org-resident custom app logic (built on Heroku) invocable from Apex/Flow via
AppLink External Services.

## Learn about `sf` plugins

Salesforce CLI plugins are based on the [oclif plugin framework](https://oclif.io/docs/introduction). Read the [plugin developer guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_plugins.meta/sfdx_cli_plugins/cli_plugins_architecture_sf_cli.htm) to learn about Salesforce CLI plugin development.

This repository contains a lot of additional scripts and tools to help with general Salesforce node development and enforce coding standards. You should familiarize yourself with some of the [node developer packages](#tooling) used by Salesforce. There is also a default circleci config using the [release management orb](https://github.com/forcedotcom/npm-release-management-orb) standards.

Additionally, there are some additional tests that the Salesforce CLI will enforce if this plugin is ever bundled with the CLI. These test are included by default under the `posttest` script and it is required to keep these tests active in your plugin if you plan to have it bundled.

### Tooling

- [@salesforce/core](https://github.com/forcedotcom/sfdx-core)
- [@salesforce/kit](https://github.com/forcedotcom/kit)
- [@salesforce/sf-plugins-core](https://github.com/salesforcecli/sf-plugins-core)
- [@salesforce/ts-types](https://github.com/forcedotcom/ts-types)
- [@salesforce/ts-sinon](https://github.com/forcedotcom/ts-sinon)
- [@salesforce/dev-config](https://github.com/forcedotcom/dev-config)
- [@salesforce/dev-scripts](https://github.com/forcedotcom/dev-scripts)

# Everything past here is only a suggestion as to what should be in your specific plugin's description

This plugin is bundled with the [Salesforce CLI](https://developer.salesforce.com/tools/sfdxcli). For more information on the CLI, read the [getting started guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm).

We always recommend using the latest version of these commands bundled with the CLI, however, you can install a specific version or tag if needed.

## Install

```bash
sf plugins install @salesforce/plugin-compute@x.y.z
```

## Issues

Please report any issues at https://github.com/forcedotcom/cli/issues

## Contributing

1. Please read our [Code of Conduct](CODE_OF_CONDUCT.md)
2. Create a new issue before starting your project so that we can keep track of
   what you are trying to add/fix. That way, we can also offer suggestions or
   let you know if there is already an effort in progress.
3. Fork this repository.
4. [Build the plugin locally](#build)
5. Create a _topic_ branch in your fork. Note, this step is recommended but technically not required if contributing using a fork.
6. Edit the code in your fork.
7. Write appropriate tests for your changes. Try to achieve at least 95% code coverage on any new code. No pull request will be accepted without unit tests.
8. Sign CLA (see [CLA](#cla) below).
9. Send us a pull request when you are done. We'll review your code, suggest any needed changes, and merge it in.

### CLA

External contributors will be required to sign a Contributor's License
Agreement. You can do so by going to https://cla.salesforce.com/sign-cla.

### Build

To build the plugin locally, make sure to have yarn installed and run the following commands:

```bash
# Clone the repository
git clone git@github.com:salesforcecli/plugin-compute

# Install the dependencies and compile
yarn && yarn build
```

To use your plugin, run using the local `./bin/dev` or `./bin/dev.cmd` file.

```bash
# Run using local run file.
./bin/dev compute generate --name MyComputeApp
```

There should be no differences when running via the Salesforce CLI or using the local run file. However, it can be useful to link the plugin to do some additional testing or run your commands from anywhere on your machine.

```bash
# Link your plugin to the sf cli
sf plugins link .
# To verify
sf plugins
```

## Commands

<!-- commands -->

- [`sf compute generate`](#sf-compute-generate)

## `sf compute generate`

Scaffold a new compute app into your Salesforce DX project.

```
USAGE
  $ sf compute generate -n <value> [--json] [--flags-dir <value>] [-o <value>] [-d <value>] [-l node|python]

FLAGS
  -d, --output-dir=<value>  [default: force-app/main/default/compute] Directory to create the app in.
  -l, --language=<option>   [default: node] Language to scaffold the starter project in.
                            <options: node|python>
  -n, --name=<value>        (required) Name for the new compute app.
  -o, --target-org=<value>  Org to associate the app with (username or alias).

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Scaffold a new compute app into your Salesforce DX project.

  Creates the app directory under force-app/main/default/compute/<name>/ (or
  --output-dir) with a compute metadata file, a Procfile, a project.toml, and
  starter source in the language you choose with --language. This command runs
  entirely locally; no org is contacted.

EXAMPLES
  Scaffold a Node.js compute app named LeaseAgreementParser:

    $ sf compute generate --name LeaseAgreementParser

  Scaffold a Python compute app and associate it with an org:

    $ sf compute generate --name ReceiptOcr --language python --target-org my-org

FLAG DESCRIPTIONS
  -d, --output-dir=<value>  Directory to create the app in.

    Defaults to force-app/main/default/compute. The app itself is created in a
    subdirectory named after --name.

  -l, --language=node|python  Language to scaffold the starter project in.

    Compute apps can run any Heroku-supported language, but generate currently
    scaffolds starters for node and python only.
```

_See code: [src/commands/compute/generate.ts](https://github.com/salesforcecli/plugin-compute/blob/v1.0.0/src/commands/compute/generate.ts)_

<!-- commandsstop -->
