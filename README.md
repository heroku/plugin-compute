# plugin-compute

[![NPM](https://img.shields.io/npm/v/@heroku/plugin-compute.svg?label=@heroku/plugin-compute)](https://www.npmjs.com/package/@heroku/plugin-compute) [![Downloads/week](https://img.shields.io/npm/dw/@heroku/plugin-compute.svg)](https://npmjs.org/package/@heroku/plugin-compute) [![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/license/apache-2-0)

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

This plugin is bundled with the [Salesforce CLI](https://developer.salesforce.com/tools/sfdxcli). For more information on the CLI, read the [getting started guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm).

We always recommend using the latest version of these commands bundled with the CLI, however, you can install a specific version or tag if needed.

## Install

```bash
sf plugins install @heroku/plugin-compute@x.y.z
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

To build the plugin locally, run the following commands:

```bash
# Clone the repository
git clone git@github.com:salesforcecli/plugin-compute

# Install the dependencies and compile
npm ci && npm run build
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
* [`sf compute build output`](#sf-compute-build-output)
* [`sf compute config`](#sf-compute-config)
* [`sf compute config get [KEY]`](#sf-compute-config-get-key)
* [`sf compute config set [PAIR]`](#sf-compute-config-set-pair)
* [`sf compute config unset [KEY]`](#sf-compute-config-unset-key)
* [`sf compute deploy`](#sf-compute-deploy)
* [`sf compute display`](#sf-compute-display)
* [`sf compute generate`](#sf-compute-generate)
* [`sf compute list`](#sf-compute-list)
* [`sf compute logs`](#sf-compute-logs)
* [`sf compute scale [TARGET]`](#sf-compute-scale-target)
* [`sf compute source retrieve`](#sf-compute-source-retrieve)

## `sf compute build output`

Print the build/compile log for a compute app's latest build.

```
USAGE
  $ sf compute build output -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to fetch build output for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Print the build/compile log for a compute app's latest build.

  Fetches the bounded build/compile log (dependency install, slug compile,
  release) for the most recent build of a compute app -- useful right after
  deploy to confirm the build compiled. This is a one-shot fetch of a
  finished-or-in-progress log, not a live stream; use compute logs --tail for
  the ongoing runtime log.

  This is a read-only, org-mediated lookup by --name (the app's DeveloperName)
  -- the org calls Heroku's Build Info API on your behalf. It doesn't read from
  or require a local Salesforce DX project.

EXAMPLES
  Print the latest build's log:

    $ sf compute build output --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/build/output.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/build/output.ts)_

## `sf compute config`

List a compute app's config vars.

```
USAGE
  $ sf compute config -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to show config for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  List a compute app's config vars.

  Shows every config var (environment variable) currently set for a deployed
  compute app, sorted alphabetically. Goes through the target org's Salesforce
  Connect API, which calls Heroku on your behalf. Use config get to read a
  single var's value, config set to add or change vars, or config unset to
  remove them.

EXAMPLES
  List all config vars for a compute app:

    $ sf compute config --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/config.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/config.ts)_

## `sf compute config get [KEY]`

Print one or more of a compute app's config var values.

```
USAGE
  $ sf compute config get [KEY...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to read config from (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Print one or more of a compute app's config var values.

  Goes through the target org's Salesforce Connect API, which calls Heroku on
  your behalf. Pass a single key to print its bare value, or more than one to
  print each as key: value. Fails if any requested key isn't currently set.

EXAMPLES
  Print a single config var's value:

    $ sf compute config get STRIPE_KEY --name CreditRatingScorer --target-org my-org

  Print more than one config var:

    $ sf compute config get STRIPE_KEY LOG_LEVEL --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/config/get.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/config/get.ts)_

## `sf compute config set [PAIR]`

Set one or more of a compute app's config vars.

```
USAGE
  $ sf compute config set [PAIR...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to change config for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Set one or more of a compute app's config vars.

  Goes through the target org's Salesforce Connect API, which calls Heroku on
  your behalf. Setting a config var restarts the app's dynos so the new value
  takes effect. Pass one or more KEY=VALUE pairs; a key that doesn't already
  exist is created.

EXAMPLES
  Set a single config var:

    $ sf compute config set STRIPE_KEY=sk_live_xyz789 --name CreditRatingScorer --target-org my-org

  Set more than one config var in one command:

    $ sf compute config set STRIPE_KEY=sk_live_xyz789 LOG_LEVEL=debug --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/config/set.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/config/set.ts)_

## `sf compute config unset [KEY]`

Unset one or more of a compute app's config vars.

```
USAGE
  $ sf compute config unset [KEY...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to change config for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Unset one or more of a compute app's config vars.

  Goes through the target org's Salesforce Connect API, which calls Heroku on
  your behalf. Unsetting a config var restarts the app's dynos so the removal
  takes effect. Fails if any requested key isn't currently set.

EXAMPLES
  Unset a single config var:

    $ sf compute config unset LOG_LEVEL --name CreditRatingScorer --target-org my-org

  Unset more than one config var in one command:

    $ sf compute config unset LOG_LEVEL DEBUG_MODE --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/config/unset.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/config/unset.ts)_

## `sf compute deploy`

Deploy a compute app's source and metadata to an org.

```
USAGE
  $ sf compute deploy -o <value> [--json] [--flags-dir <value>] [-d <value>]

FLAGS
  -d, --source-dir=<value>  [default: current directory] Directory containing the compute app to deploy. Defaults to the
                            current directory.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Deploy a compute app's source and metadata to an org.

  Packages the compute app's source (everything under its directory except the
  compute metadata file, project.toml, and .forceignore) together with its
  api-spec.yaml into a deployment bundle, uploads it to the org through the
  Connect API, then deploys the app's <name>.compute-meta.xml through the
  Metadata API to trigger the build. The metadata deploy itself returns a job
  ID that can be checked independently with "sf project deploy report
  --job-id <id>". Deploy is asynchronous: this command returns once the build
  has been enqueued, it doesn't wait for the build to finish.

  Files matching patterns in a .forceignore are excluded from the source
  bundle. Both the compute app's own .forceignore and the one at the project
  root (next to sfdx-project.json) are applied, if present.

EXAMPLES
  Deploy a compute app to an org, from inside the app's own directory:
  cd force-app/main/default/platformComputeApps/CreditRatingScorer
  $ sf compute deploy --target-org my-org

  Deploy a compute app to an org, from anywhere, by pointing --source-dir at it:

    $ sf compute deploy --source-dir force-app/main/default/platformComputeApps/CreditRatingScorer --target-org \
      my-org
```

_See code: [src/commands/compute/deploy.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/deploy.ts)_

## `sf compute display`

Show the current org-side status of a deployed compute app.

```
USAGE
  $ sf compute display -o <value> [--json] [--flags-dir <value>] [-n <value>] [-v]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to show status for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
  -v, --verbose             Also show external service registration and current build detail.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Show the current org-side status of a deployed compute app.

  Queries the org for the compute app's current deployment status: its master
  label, description, and overall status. With --verbose, also shows whether
  an external service has been registered for it (and whether it's active),
  plus the phase, timestamps, and error detail of its current build.

  This is a read-only, live lookup by --name (the app's DeveloperName) -- it
  doesn't read from or require a local Salesforce DX project.

EXAMPLES
  Show the current status of a compute app:

    $ sf compute display --name CreditRatingScorer --target-org my-org

  Include external service and current build detail:

    $ sf compute display --name CreditRatingScorer --target-org my-org --verbose
```

_See code: [src/commands/compute/display.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/display.ts)_

## `sf compute generate`

Scaffold a new compute app into your Salesforce DX project.

```
USAGE
  $ sf compute generate -n <value> [--json] [--flags-dir <value>] [-d <value>] [-l node|python]

FLAGS
  -d, --output-dir=<value>  [default: force-app/main/default/platformComputeApps] Directory to create the app in.
  -l, --language=<option>   [default: node] Language to scaffold the starter project in.
                            <options: node|python>
  -n, --name=<value>        (required) Name for the new compute app. Use <namespace>\_\_<developerName> to scaffold
                            it under a namespace.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Scaffold a new compute app into your Salesforce DX project.

  Creates the app directory under force-app/main/default/platformComputeApps/<name>/ (or
  --output-dir) with a compute metadata file, a Procfile, a project.toml, and
  starter source in the language you choose with --language. No org is
  contacted, but this command does fetch the starter source for the chosen
  language from its Heroku AppLink reference app on GitHub, so it requires
  outbound network access.

EXAMPLES
  Scaffold a Node.js compute app named CreditRatingScorer:

    $ sf compute generate --name CreditRatingScorer

  Scaffold a Python compute app into a custom directory:

    $ sf compute generate --name ReceiptOcr --language python --output-dir \
      force-app/main/default/platformComputeApps/scorers

FLAG DESCRIPTIONS
  -d, --output-dir=<value>  Directory to create the app in.

    Defaults to force-app/main/default/platformComputeApps. The app itself is created in a
    subdirectory named after --name.

  -l, --language=node|python  Language to scaffold the starter project in.

    Compute apps can run any Heroku-supported language, but generate currently
    scaffolds starters for node and python only.
```

_See code: [src/commands/compute/generate.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/generate.ts)_

## `sf compute list`

List the compute apps deployed in an org.

```
USAGE
  $ sf compute list -o <value> [--json] [--flags-dir <value>]

FLAGS
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  List the compute apps deployed in an org.

  Queries the org for every compute app (PlatformComputeApp). The table shows
  each app's master label, status, and status reason; for description, external
  service registration, and current build detail on a single app, use compute
  display (the full detail is also available here via --json).

  This is a read-only, live lookup -- it doesn't read from or require a local
  Salesforce DX project.

EXAMPLES
  List the compute apps in an org:

    $ sf compute list --target-org my-org
```

_See code: [src/commands/compute/list.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/list.ts)_

## `sf compute logs`

Print or stream the runtime log for a compute app.

```
USAGE
  $ sf compute logs -o <value> [--flags-dir <value>] [-n <value>] [--num <value>] [--tail | --json]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to fetch logs for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
      --num=<value>         [default: 100] Number of historical log lines to print before new output.
      --tail                Keep the session open and print new log lines as they arrive.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Print or stream the runtime log for a compute app.

  Fetches a compute app's runtime log -- this is the app's ongoing output
  (request handling, application logs), not the build/compile log; use
  compute build output for that.

  This is an org-mediated operation by --name (the app's DeveloperName) -- the
  org creates a log session with Heroku on your behalf and hands back a
  short-lived, pre-authorized URL that the CLI reads from directly. It doesn't
  read from or require a local Salesforce DX project.

  By default this prints the most recent log lines and exits. Pass --tail to
  keep the session open and print new lines as they arrive, until you stop it
  with Ctrl-C or the session ends on its own.

  --tail can't be combined with --json, since a live stream has no single
  point at which to emit one JSON result.

EXAMPLES
  Print the most recent log lines:

    $ sf compute logs --name CreditRatingScorer --target-org my-org

  Print the most recent 500 log lines:

    $ sf compute logs --name CreditRatingScorer --num 500 --target-org my-org

  Tail the log until stopped with Ctrl-C:

    $ sf compute logs --name CreditRatingScorer --tail --target-org my-org
```

_See code: [src/commands/compute/logs.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/logs.ts)_

## `sf compute scale [TARGET]`

Resize or rescale a compute app's dyno formation.

```
USAGE
  $ sf compute scale [TARGET...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to scale (or
                            <namespace>\_\_<developerName>
                            if it was deployed under a namespace). Defaults to the COMPUTE_APP_NAME
                            environment variable, or the current directory's app name if that isn't set
                            either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Resize or rescale a compute app's dyno formation.

  Updates one or more process types' dyno size and/or quantity for a deployed
  compute app. Pass one target per process type in the form
  type[=count][:size], for example web=2 or web:dyno-1c-4gb or
  web=2:dyno-1c-4gb. This goes through the target org's Salesforce Connect API,
  which calls Heroku on your behalf.

EXAMPLES
  Change a process type's dyno size:

    $ sf compute scale web:dyno-2c-8gb --name CreditRatingScorer --target-org my-org

  Scale a process type's dyno count:

    $ sf compute scale worker=3 --name CreditRatingScorer --target-org my-org

  Change size and quantity together:

    $ sf compute scale web=2:dyno-4c-16gb --name CreditRatingScorer --target-org my-org

  Scale multiple process types in one command:

    $ sf compute scale web=2:dyno-4c-16gb worker=1:dyno-1c-0.5gb --name CreditRatingScorer --target-org my-org

  Stop all dynos of a process type:

    $ sf compute scale worker=0 --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/scale.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/scale.ts)_

## `sf compute source retrieve`

Retrieve a compute app's source and metadata from an org into your local Salesforce DX project.

```
USAGE
  $ sf compute source retrieve -n <value> -o <value> [--json] [--flags-dir <value>] [-d <value>]

FLAGS
  -d, --output-dir=<value>  [default: force-app/main/default/platformComputeApps] Directory to create the app in.
  -n, --name=<value>        (required) DeveloperName of the compute app to retrieve (or <namespace>\_\_<developerName>
                            if it was deployed under a namespace).
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Retrieve a compute app's source and metadata from an org into your local Salesforce DX project.

  Creates the compute app's directory under force-app/main/default/platformComputeApps/<name>/
  (or --output-dir), retrieves its <name>.compute-meta.xml through the Metadata
  API, then downloads its source code through the Connect API and extracts it
  into that same directory. This is the inverse of sf compute deploy.

EXAMPLES
  Retrieve a compute app's source and metadata from an org:

    $ sf compute source retrieve --name CreditRatingScorer --target-org my-org

FLAG DESCRIPTIONS
  -d, --output-dir=<value>  Directory to create the app in.

    Defaults to force-app/main/default/platformComputeApps. The app itself is created in a
    subdirectory named after --name.
```

_See code: [src/commands/compute/source/retrieve.ts](https://github.com/heroku/plugin-compute/blob/v0.1.0/src/commands/compute/source/retrieve.ts)_
<!-- commandsstop -->
