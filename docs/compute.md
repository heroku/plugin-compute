`sf compute`
============

Manage Salesforce Compute apps.

* [`sf compute create telemetry-drain`](#sf-compute-create-telemetry-drain)
* [`sf compute delete telemetry-drain ID`](#sf-compute-delete-telemetry-drain-id)
* [`sf compute deploy`](#sf-compute-deploy)
* [`sf compute display`](#sf-compute-display)
* [`sf compute display telemetry-drain ID`](#sf-compute-display-telemetry-drain-id)
* [`sf compute generate`](#sf-compute-generate)
* [`sf compute get build-log`](#sf-compute-get-build-log)
* [`sf compute get config [KEY]`](#sf-compute-get-config-key)
* [`sf compute get runtime-log`](#sf-compute-get-runtime-log)
* [`sf compute list`](#sf-compute-list)
* [`sf compute list config`](#sf-compute-list-config)
* [`sf compute list telemetry-drain`](#sf-compute-list-telemetry-drain)
* [`sf compute scale`](#sf-compute-scale)
* [`sf compute set config [PAIR]`](#sf-compute-set-config-pair)
* [`sf compute source retrieve`](#sf-compute-source-retrieve)
* [`sf compute tail runtime-log`](#sf-compute-tail-runtime-log)
* [`sf compute unset config [KEY]`](#sf-compute-unset-config-key)
* [`sf compute update telemetry-drain ID`](#sf-compute-update-telemetry-drain-id)

## `sf compute create telemetry-drain`

Add a telemetry drain to a compute app.

```
USAGE
  $ sf compute create telemetry-drain --url <value> -o <value> [--json] [--flags-dir <value>] [-n <value>] [--signals <value>]
    [--transport <value>] [--header <value>...]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to add the drain to (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
      --header=<value>...   Header to send with each export, as key=value.
      --signals=<value>     [default: all] Comma-separated signals to forward: traces, metrics, logs, or all.
      --transport=<value>   [default: http] Wire protocol to use: http (OTLP over HTTP) or grpc (OTLP over gRPC).
      --url=<value>         (required) Endpoint to forward telemetry to.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Add a telemetry drain to a compute app.

  Creates an OpenTelemetry drain that forwards the compute app's logs, metrics,
  and traces to the endpoint you give with --url. Choose which signals to
  forward with --signals and the wire protocol with --transport. Use
  sf compute update telemetry-drain to change a drain later.

EXAMPLES
  Forward all signals from a compute app to an OTLP/HTTP collector:

    $ sf compute create telemetry-drain --name CreditRatingScorer --url https://collector.example.com:4318 \
      --target-org my-org

  Forward only traces and logs over gRPC, with an auth header:

    $ sf compute create telemetry-drain --name CreditRatingScorer --url https://collector.example.com:4317 \
      --transport grpc --signals traces,logs --header "x-api-key=my-key" --target-org my-org

FLAG DESCRIPTIONS
  --header=<value>...  Header to send with each export, as key=value.

    Repeat the flag to send more than one header. Header values often carry
    credentials; they are sent to the endpoint and are never printed to the
    terminal, but are included in --json output.
```

_See code: [src/commands/compute/create/telemetry-drain.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/create/telemetry-drain.ts)_

## `sf compute delete telemetry-drain ID`

Delete a compute telemetry drain.

```
USAGE
  $ sf compute delete telemetry-drain ID -o <value> [--json] [--flags-dir <value>] [--no-prompt]

FLAGS
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
      --no-prompt           Don't ask for confirmation before deleting.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Delete a compute telemetry drain.

  Removes a single OpenTelemetry drain by its ID, so its compute app stops
  forwarding logs, metrics, and traces to the drain's endpoint. This can't be
  undone; to forward telemetry again, create a new drain. You're asked to
  confirm first unless you pass --no-prompt. Use sf compute list telemetry-drain
  to find a drain's ID.

EXAMPLES
  Delete a telemetry drain, confirming first:

    $ sf compute delete telemetry-drain 01234567-89ab-cdef-0123-456789abcdef --target-org my-org

  Delete a telemetry drain without the confirmation prompt, for scripts:

    $ sf compute delete telemetry-drain 01234567-89ab-cdef-0123-456789abcdef --target-org my-org --no-prompt
```

_See code: [src/commands/compute/delete/telemetry-drain.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/delete/telemetry-drain.ts)_

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
  compute metadata file and .forceignore) together with its api-spec.yaml into
  a deployment bundle, uploads it to the org through the Connect API, then
  deploys the app's <name>.compute-meta.xml through the
  Metadata API to trigger the build. The metadata deploy itself returns a job
  ID that can be checked independently with "sf project deploy report
  --job-id <id>". Deploy is asynchronous: this command returns once the build
  has been enqueued, it doesn't wait for the build to finish.

  Files matching patterns in a .forceignore are excluded from the source
  bundle. Both the compute app's own .forceignore and the one at the project
  root (next to sfdx-project.json) are applied, if present. api-spec.yaml and
  project.toml are always included, since the build can't succeed without them.

EXAMPLES
  Deploy a compute app to an org, from inside the app's own directory:
  cd force-app/main/default/platformComputeApps/CreditRatingScorer
  $ sf compute deploy --target-org my-org

  Deploy a compute app to an org, from anywhere, by pointing --source-dir at it:

    $ sf compute deploy --source-dir force-app/main/default/platformComputeApps/CreditRatingScorer --target-org \
      my-org
```

_See code: [src/commands/compute/deploy.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/deploy.ts)_

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

_See code: [src/commands/compute/display.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/display.ts)_

## `sf compute display telemetry-drain ID`

Show the full detail of a single compute telemetry drain.

```
USAGE
  $ sf compute display telemetry-drain ID -o <value> [--json] [--flags-dir <value>]

FLAGS
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Show the full detail of a single compute telemetry drain.

  Shows a single OpenTelemetry drain in full: the compute app it belongs to,
  the signals it forwards, and its exporter endpoint, transport, and headers.
  Use sf compute list telemetry-drain to find a drain's ID.

EXAMPLES
  Show the detail of a telemetry drain by its ID:

    $ sf compute display telemetry-drain 01234567-89ab-cdef-0123-456789abcdef --target-org my-org
```

_See code: [src/commands/compute/display/telemetry-drain.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/display/telemetry-drain.ts)_

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

  This command is deprecated but still works. When you move to sf template generate
  project --template compute, note that --language no longer defaults to node: the
  replacement's --compute-language flag makes the language an explicit choice.

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

_See code: [src/commands/compute/generate.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/generate.ts)_

## `sf compute get build-log`

Print the build/compile log for a compute app's latest build.

```
USAGE
  $ sf compute get build-log -o <value> [--json] [--flags-dir <value>] [-n <value>]

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
  finished-or-in-progress log, not a live stream; use compute tail runtime-log
  for the ongoing runtime log.

  This is a read-only, org-mediated lookup by --name (the app's DeveloperName)
  -- the org calls Heroku's Build Info API on your behalf. It doesn't read from
  or require a local Salesforce DX project.

EXAMPLES
  Print the latest build's log:

    $ sf compute get build-log --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/get/build-log.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/get/build-log.ts)_

## `sf compute get config [KEY]`

Print one or more of a compute app's config var values.

```
USAGE
  $ sf compute get config [KEY...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

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

    $ sf compute get config STRIPE_KEY --name CreditRatingScorer --target-org my-org

  Print more than one config var:

    $ sf compute get config STRIPE_KEY LOG_LEVEL --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/get/config.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/get/config.ts)_

## `sf compute get runtime-log`

Print the recent runtime log for a compute app.

```
USAGE
  $ sf compute get runtime-log -o <value> [--json] [--flags-dir <value>] [-n <value>] [--num <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to fetch logs for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
      --num=<value>         [default: 100] Number of recent log lines to print.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Print the recent runtime log for a compute app.

  Fetches a compute app's runtime log -- the app's ongoing output (request
  handling, application logs), not the build/compile log; use compute get
  build-log for that.

  This prints the most recent log lines and exits. To keep the session open and
  stream new lines as they arrive, use compute tail runtime-log.

  This is an org-mediated operation by --name (the app's DeveloperName) -- the
  org creates a log session with Heroku on your behalf and hands back a
  short-lived, pre-authorized URL that the CLI reads from directly. It doesn't
  read from or require a local Salesforce DX project.

EXAMPLES
  Print the most recent log lines:

    $ sf compute get runtime-log --name CreditRatingScorer --target-org my-org

  Print the most recent 500 log lines:

    $ sf compute get runtime-log --name CreditRatingScorer --num 500 --target-org my-org
```

_See code: [src/commands/compute/get/runtime-log.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/get/runtime-log.ts)_

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

_See code: [src/commands/compute/list.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/list.ts)_

## `sf compute list config`

List a compute app's config vars.

```
USAGE
  $ sf compute list config -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to list config vars for (or
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
  Connect API, which calls Heroku on your behalf. Use sf compute get config to
  read a single var's value, sf compute set config to add or change vars, or
  sf compute unset config to remove them.

EXAMPLES
  List all config vars for a compute app:

    $ sf compute list config --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/list/config.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/list/config.ts)_

## `sf compute list telemetry-drain`

List the telemetry drains configured for a compute app.

```
USAGE
  $ sf compute list telemetry-drain -o <value> [--json] [--flags-dir <value>] [-n <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to list telemetry drains for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  List the telemetry drains configured for a compute app.

  Shows every OpenTelemetry drain forwarding the compute app's logs, metrics,
  and traces, with each drain's ID, signals, and endpoint. Use
  sf compute display telemetry-drain to see the full detail of a single drain.

EXAMPLES
  List the telemetry drains for a compute app:

    $ sf compute list telemetry-drain --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/list/telemetry-drain.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/list/telemetry-drain.ts)_

## `sf compute scale`

Resize or rescale a compute app's dyno formation.

```
USAGE
  $ sf compute scale -o <value> --process-type <value> [--json] [--flags-dir <value>] [-n <value>] [--quantity
    <value>] [--size <value>]

FLAGS
  -n, --name=<value>          [env: COMPUTE_APP_NAME] DeveloperName of the compute app to scale (or
                              <namespace>\_\_<developerName>
                              if it was deployed under a namespace). Defaults to the COMPUTE_APP_NAME
                              environment variable, or the current directory's app name if that isn't set
                              either.
  -o, --target-org=<value>    (required) Username or alias of the target org. Not required if the `target-org`
                              configuration variable is already set.
      --process-type=<value>  (required) Process type to scale, for example web or worker.
      --quantity=<value>      Number of dynos to run for the process type (0 stops all dynos of that type).
      --size=<value>          Dyno size to run the process type on, for example dyno-1c-4gb.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Resize or rescale a compute app's dyno formation.

  Updates a single process type's dyno size and/or quantity for a deployed
  compute app. Pass the process type with --process-type and at least one of
  --quantity or --size. This goes through the target org's Salesforce Connect
  API, which calls Heroku on your behalf.

EXAMPLES
  Change a process type's dyno size:

    $ sf compute scale --process-type web --size dyno-2c-8gb --name CreditRatingScorer --target-org my-org

  Scale a process type's dyno count:

    $ sf compute scale --process-type worker --quantity 3 --name CreditRatingScorer --target-org my-org

  Change size and quantity together:

    $ sf compute scale --process-type web --quantity 2 --size dyno-4c-16gb --name CreditRatingScorer --target-org \
      my-org

  Stop all dynos of a process type:

    $ sf compute scale --process-type worker --quantity 0 --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/scale.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/scale.ts)_

## `sf compute set config [PAIR]`

Set one or more of a compute app's config vars.

```
USAGE
  $ sf compute set config [PAIR...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

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

    $ sf compute set config STRIPE_KEY=sk_live_xyz789 --name CreditRatingScorer --target-org my-org

  Set more than one config var in one command:

    $ sf compute set config STRIPE_KEY=sk_live_xyz789 LOG_LEVEL=debug --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/set/config.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/set/config.ts)_

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

_See code: [src/commands/compute/source/retrieve.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/source/retrieve.ts)_

## `sf compute tail runtime-log`

Stream the live runtime log for a compute app.

```
USAGE
  $ sf compute tail runtime-log -o <value> [--flags-dir <value>] [-n <value>] [--num <value>]

FLAGS
  -n, --name=<value>        [env: COMPUTE_APP_NAME] DeveloperName of the compute app to tail logs for (or
                            <namespace>\_\_<developerName> if it was deployed under a namespace).
                            Defaults to the COMPUTE_APP_NAME environment variable, or the current
                            directory's app name if that isn't set either.
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
      --num=<value>         [default: 100] Number of recent log lines to print before streaming new output.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.

DESCRIPTION
  Stream the live runtime log for a compute app.

  Streams a compute app's runtime log -- the app's ongoing output (request
  handling, application logs), not the build/compile log; use compute get
  build-log for that.

  Keeps the session open and prints new log lines as they arrive, until you stop
  it with Ctrl-C or the session ends on its own. For a one-time snapshot of the
  most recent lines, use compute get runtime-log.

  This is an org-mediated operation by --name (the app's DeveloperName) -- the
  org creates a log session with Heroku on your behalf and hands back a
  short-lived, pre-authorized URL that the CLI reads from directly. It doesn't
  read from or require a local Salesforce DX project.

EXAMPLES
  Tail the log until stopped with Ctrl-C:

    $ sf compute tail runtime-log --name CreditRatingScorer --target-org my-org

  Print the most recent 500 lines, then keep streaming:

    $ sf compute tail runtime-log --name CreditRatingScorer --num 500 --target-org my-org
```

_See code: [src/commands/compute/tail/runtime-log.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/tail/runtime-log.ts)_

## `sf compute unset config [KEY]`

Unset one or more of a compute app's config vars.

```
USAGE
  $ sf compute unset config [KEY...] -o <value> [--json] [--flags-dir <value>] [-n <value>]

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

    $ sf compute unset config LOG_LEVEL --name CreditRatingScorer --target-org my-org

  Unset more than one config var in one command:

    $ sf compute unset config LOG_LEVEL DEBUG_MODE --name CreditRatingScorer --target-org my-org
```

_See code: [src/commands/compute/unset/config.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/unset/config.ts)_

## `sf compute update telemetry-drain ID`

Change the configuration of a compute telemetry drain.

```
USAGE
  $ sf compute update telemetry-drain ID -o <value> [--json] [--flags-dir <value>] [--url <value>] [--signals <value>] [--transport
    <value>] [--header <value>...]

FLAGS
  -o, --target-org=<value>  (required) Username or alias of the target org. Not required if the `target-org`
                            configuration variable is already set.
      --header=<value>...   Header to send with each export, as key=value.
      --signals=<value>     New comma-separated signals to forward: traces, metrics, logs, or all.
      --transport=<value>   New wire protocol: http (OTLP over HTTP) or grpc (OTLP over gRPC).
      --url=<value>         New endpoint to forward telemetry to.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Change the configuration of a compute telemetry drain.

  Updates only the attributes you pass and leaves the rest of the drain as it
  is. Passing --header adds or overwrites the headers you give and keeps the
  drain's other headers. Use sf compute list telemetry-drain to find a drain's ID.

EXAMPLES
  Point a drain at a new endpoint:

    $ sf compute update telemetry-drain 01234567-89ab-cdef-0123-456789abcdef --url \
      https://collector.example.com:4318 --target-org my-org

  Forward only logs over gRPC:

    $ sf compute update telemetry-drain 01234567-89ab-cdef-0123-456789abcdef --signals logs --transport grpc \
      --target-org my-org

FLAG DESCRIPTIONS
  --header=<value>...  Header to send with each export, as key=value.

    Repeat the flag to send more than one header. A header you pass adds
    or overwrites the one with the same name; the drain's other headers are kept. Header values often carry credentials;
    they are
    never printed to the terminal, but are included in --json output.
```

_See code: [src/commands/compute/update/telemetry-drain.ts](https://github.com/heroku/plugin-compute/blob/v0.3.0/src/commands/compute/update/telemetry-drain.ts)_
